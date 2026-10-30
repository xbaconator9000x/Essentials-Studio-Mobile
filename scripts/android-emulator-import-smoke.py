#!/usr/bin/env python3
"""Fail-closed real Android emulator ZIP-picker and project-open test.

Inputs must be the rights-cleared synthetic original.zip from native tests.
A passing test does not verify physical SAF export, desktop reopening or gameplay.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path


def adb(*args: str, check: bool = True, timeout: int = 40) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["adb", *args], text=True, capture_output=True, check=check, timeout=timeout)


def entries(xml_text: str) -> list[dict[str, str]]:
    start = xml_text.find("<?xml")
    if start >= 0:
        xml_text = xml_text[start:]
    root = ET.fromstring(xml_text)
    return [n.attrib for n in root.iter("node")]


def center(value: str) -> tuple[int, int]:
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", value)
    if not match:
        raise ValueError(f"Invalid accessibility bounds: {value!r}")
    left, top, right, bottom = map(int, match.groups())
    if right <= left or bottom <= top:
        raise ValueError("Empty accessibility bounds")
    return (left + right) // 2, (top + bottom) // 2


def locate(nodes: list[dict[str, str]], needle: str) -> tuple[int, int] | None:
    for node in nodes:
        text = node.get("text", "") + " " + node.get("content-desc", "")
        if needle.casefold() in text.casefold() and node.get("bounds"):
            return center(node["bounds"])
    return None


def dump_ui(evidence: Path, name: str) -> list[dict[str, str]]:
    result = adb("shell", "uiautomator", "dump", "/sdcard/window.xml", check=False, timeout=35)
    if result.returncode:
        raise RuntimeError("Cannot inspect UI: " + result.stderr[-350:])
    result = adb("exec-out", "cat", "/sdcard/window.xml")
    (evidence / f"{name}.xml").write_text(result.stdout, encoding="utf-8")
    return entries(result.stdout)


def reject_editor_anr(nodes: list[dict[str, str]]) -> None:
    """Fail closed on the editor's own Android ANR, not an OS system dialog."""
    if any("essentials studio mobile isn't responding" in n.get("text", "").casefold()
           for n in nodes):
        raise AssertionError("Editor application is not responding (ANR); import not exercised")


def wait_for(evidence: Path, name: str, needle: str, seconds: int) -> tuple[int, int]:
    deadline = time.monotonic() + seconds
    last_error = ""
    while time.monotonic() < deadline:
        try:
            nodes = dump_ui(evidence, name)
            reject_editor_anr(nodes)
            point = locate(nodes, needle)
            if point:
                return point
        except (ET.ParseError, RuntimeError, subprocess.CalledProcessError) as exc:
            last_error = str(exc)
        time.sleep(3)
    raise RuntimeError(f"Missing Android UI item {needle!r}: {last_error}")


def documents_ui_visible(nodes: list[dict[str, str]]) -> bool:
    """Verify the *native* document provider actually opened, not a WebView."""
    return any(
        n.get("package", "").startswith(("com.android.documentsui", "com.google.android.documentsui"))
        for n in nodes
    )


def wait_for_document_picker(evidence: Path, seconds: int) -> list[dict[str, str]]:
    deadline = time.monotonic() + seconds
    nodes: list[dict[str, str]] = []
    while time.monotonic() < deadline:
        nodes = dump_ui(evidence, "after-import-tap")
        reject_editor_anr(nodes)
        if documents_ui_visible(nodes):
            return nodes
        time.sleep(2)
    visible = [n.get("text", "") for n in nodes if n.get("text")]
    raise RuntimeError(
        "Android DocumentsUI did not open after import control tap; "
        "native SAF picker is required if WebView file input is unsupported. "
        f"Visible UI: {visible[-12:]!r}"
    )


def picker_file_card(xml_text: str, filename: str) -> tuple[int, int] | None:
    """Tap the full DocumentsUI item, not its small nameplate or preview icon."""
    start = xml_text.find("<?xml")
    root = ET.fromstring(xml_text[start:] if start >= 0 else xml_text)
    for node in root.iter("node"):
        if node.get("resource-id") != "com.android.documentsui:id/item_root":
            continue
        # On AOSP API30, tapping the *middle of the grid thumbnail* can leave
        # GET_CONTENT open without selecting anything. The recorded failing
        # hierarchy places the actual file name in android:id/title at the
        # bottom of the card; tap that label's bounds instead.
        title = next((
            child for child in node.iter("node")
            if child.get("resource-id") == "android:id/title"
            and child.get("text", "").casefold() == filename.casefold()
            and child.get("bounds")
        ), None)
        if title is not None:
            # In API30 list mode, the title is not a clickable accessibility
            # node. Tap the *row* rather than repeatedly targeting the same
            # non-clickable TextView. Grid cards retain their title target.
            if node.get("class") == "android.widget.LinearLayout":
                return center(node.attrib["bounds"])
            return center(title.attrib["bounds"])
        if any(child.get("text", "").casefold() == filename.casefold()
               for child in node.iter("node")):
            return center(node.attrib["bounds"])
    return None


def picker_list_row_icon(xml_text: str, filename: str) -> tuple[int, int] | None:
    """Alternate touch target for the list row, away from its preview button.

    The first Android 11 run tapped the non-clickable filename twice and left
    DocumentsUI open. If a full-row tap also fails, exercise the leading icon
    region exactly once and preserve a failed import unless the editor opens.
    """
    start = xml_text.find("<?xml")
    root = ET.fromstring(xml_text[start:] if start >= 0 else xml_text)
    for node in root.iter("node"):
        if (node.get("resource-id") != "com.android.documentsui:id/item_root"
                or node.get("class") != "android.widget.LinearLayout"):
            continue
        if not any(child.get("text", "").casefold() == filename.casefold()
                   for child in node.iter("node")):
            continue
        _, cy = center(node.attrib["bounds"])
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib["bounds"])
        if bounds is None:
            return None
        x1, _, x2, _ = map(int, bounds.groups())
        return min(x1 + 80, x2 - 1), cy
    return None


def picker_preview_control(nodes: list[dict[str, str]], filename: str) -> tuple[int, int] | None:
    """AOSP exposes an actual clickable preview action even when ZIP rows are not clickable.

    Use it only after ordinary file selection has failed. The preview itself
    never counts as import success; a subsequent project-open receipt is required.
    """
    for node in nodes:
        if (node.get("resource-id") == "com.android.documentsui:id/preview_icon"
                and node.get("content-desc", "").casefold() ==
                f"Preview the file {filename}".casefold()
                and node.get("clickable") == "true"
                and node.get("bounds")):
            return center(node["bounds"])
    return None


def picker_list_view_control(nodes: list[dict[str, str]]) -> tuple[int, int] | None:
    """Prefer DocumentsUI's accessible list mode over the ambiguous grid thumbnail."""
    for node in nodes:
        if (node.get("resource-id") == "com.android.documentsui:id/sub_menu_list"
                and node.get("content-desc") == "List view" and node.get("bounds")):
            return center(node["bounds"])
    return None


def editor_visible(nodes: list[dict[str, str]]) -> bool:
    """Require a loaded project, not merely the welcome screen or picker."""
    return (
        locate(nodes, "Essentials Studio —") is not None
        and locate(nodes, "Export ZIP") is not None
        and not any("Project ZIP import failed" in n.get("text", "") for n in nodes)
    )


def wait_for_editor(evidence: Path, seconds: int) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            nodes = dump_ui(evidence, "after-picker")
            reject_editor_anr(nodes)
            if editor_visible(nodes):
                return True
            if any("Project ZIP import failed" in n.get("text", "") for n in nodes):
                return False
        except (ET.ParseError, RuntimeError, subprocess.CalledProcessError):
            pass
        time.sleep(3)
    return False


def tap(point: tuple[int, int]) -> None:
    adb("shell", "input", "tap", str(point[0]), str(point[1]))


def capture(evidence: Path) -> None:
    for name, args in (
        ("import-screen.png", ("exec-out", "screencap", "-p")),
        ("import-logcat.txt", ("logcat", "-d", "-v", "threadtime")),
        ("import-activities.txt", ("shell", "dumpsys", "activity", "activities")),
    ):
        try:
            result = subprocess.run(["adb", *args], capture_output=True, timeout=30, check=False)
            (evidence / name).write_bytes(result.stdout + (result.stderr if result.returncode else b""))
        except (OSError, subprocess.TimeoutExpired):
            pass



def system_anr_wait_button(nodes: list[dict[str, str]]) -> tuple[int, int] | None:
    """Only dismiss the OS process ANR's Wait button, never an app ANR."""
    labels = [n.get("text", "").strip().casefold() for n in nodes]
    # Android 11 AOSP reports SystemUI ANRs under either the process name
    # or the user-facing "System UI" label. Never accept the editor's ANR.
    system_labels = {
        "process system isn't responding",
        "system ui isn't responding",
        "com.android.systemui isn't responding",
    }
    if not any(label in system_labels for label in labels):
        return None
    for node in nodes:
        if node.get("text", "").strip().casefold() == "wait" and node.get("bounds"):
            return center(node["bounds"])
    return None


def recover_system_anr(evidence: Path) -> bool:
    """Bounded, logged AOSP boot ANR recovery; never declare an import pass."""
    evidence.mkdir(parents=True, exist_ok=True)
    try:
        nodes = dump_ui(evidence, "system-anr")
        button = system_anr_wait_button(nodes)
        if button is None:
            return False
        tap(button)
        (evidence / "system-anr-recovery.txt").write_text(
            "Tapped Android OS process ANR Wait; editor focus still requires verification.\\n",
            encoding="utf-8",
        )
        return True
    except (RuntimeError, ET.ParseError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        (evidence / "system-anr-recovery.txt").write_text(
            "Could not safely dismiss OS ANR: " + str(exc)[:400] + "\\n",
            encoding="utf-8",
        )
        return False


def smoke(fixture: Path, evidence: Path, package: str) -> None:
    if not fixture.is_file() or fixture.stat().st_size == 0:
        raise FileNotFoundError("Native-generated synthetic original.zip is required")
    evidence.mkdir(parents=True, exist_ok=True)
    remote = "/sdcard/Download/EssentialsSynthetic.zip"
    original_hash = hashlib.sha256(fixture.read_bytes()).hexdigest()
    adb("shell", "mkdir", "-p", "/sdcard/Download")
    adb("push", str(fixture), remote, timeout=90)
    copied_hash = adb("shell", "sha256sum", remote).stdout.split()[0]
    if copied_hash != original_hash:
        raise AssertionError("Fixture changed during ADB transfer")
    adb("shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
        "-d", f"file://{remote}", check=False)
    receipt: dict[str, object] = {
        "source_sha": __import__("os").environ.get("GITHUB_SHA", "local"),
        "fixture_sha256": original_hash, "package": package, "result": "failed"
    }
    try:
        # Tap the actual input's accessibility button, not the surrounding
        # label text; assert that a native picker launches before looking for
        # a file. A missing picker is an app integration defect, not a missing
        # "Show roots" menu item.
        tap(wait_for(evidence, "landing", "Choose Essentials Project ZIP", 50))
        wait_for_document_picker(evidence, 15)
        try:
            selected = wait_for(evidence, "picker", "EssentialsSynthetic.zip", 18)
        except RuntimeError:
            tap(wait_for(evidence, "picker-menu", "Show roots", 12))
            tap(wait_for(evidence, "picker-downloads", "Downloads", 15))
            selected = wait_for(evidence, "picker-file", "EssentialsSynthetic.zip", 25)
        # A file may appear under Recent without opening Downloads; capture
        # the current picker hierarchy for either path before selecting it.
        nodes = dump_ui(evidence, "picker-file")
        # The API30 DocumentsUI grid exposes a non-clickable item_root and
        # non-clickable title. Switch to the native list presentation when
        # available; this is an actual UI interaction, not a bypass of SAF.
        list_toggle = picker_list_view_control(nodes)
        if list_toggle is not None:
            tap(list_toggle)
            time.sleep(2)
            nodes = dump_ui(evidence, "picker-file-list")
            if not documents_ui_visible(nodes):
                raise AssertionError("DocumentsUI disappeared while switching to list mode")
        xml_name = "picker-file-list.xml" if list_toggle is not None else "picker-file.xml"
        xml = (evidence / xml_name).read_text(encoding="utf-8")
        card = picker_file_card(xml, "EssentialsSynthetic.zip")
        if card is None:
            raise AssertionError("Cannot locate the synthetic ZIP picker item")
        tap(card)
        # AOSP file rows sometimes select on first tap and open on second.
        # Inspect the *actual* provider after the first tap; never tap blindly
        # after it has returned to the editor or an import-error dialog.
        time.sleep(4)
        nodes = dump_ui(evidence, "after-first-file-tap")
        if documents_ui_visible(nodes):
            second = picker_file_card(
                (evidence / "after-first-file-tap.xml").read_text(encoding="utf-8"),
                "EssentialsSynthetic.zip",
            )
            if second is not None:
                if list_toggle is not None:
                    alternate = picker_list_row_icon(
                        (evidence / "after-first-file-tap.xml").read_text(encoding="utf-8"),
                        "EssentialsSynthetic.zip",
                    )
                    if alternate is not None:
                        second = alternate
                (evidence / "picker-tap-targets.txt").write_text(
                    f"first={card} second={second} list_mode={list_toggle is not None}\n",
                    encoding="utf-8",
                )
                tap(second)
        # The Android 11 DocumentsUI ZIP row remained inert even with an
        # unrestricted */* picker (run 41127092100). The accessibility tree
        # exposes a distinct clickable "Preview the file" control. Exercise
        # that native control once, preserving the resulting UI and only
        # following an explicitly clickable Open/Select action if offered.
        # A preview or file list is NEVER treated as a successful import.
        time.sleep(3)
        nodes = dump_ui(evidence, "after-second-file-tap")
        if documents_ui_visible(nodes):
            preview = picker_preview_control(nodes, "EssentialsSynthetic.zip")
            if preview is not None:
                tap(preview)
                time.sleep(3)
                nodes = dump_ui(evidence, "after-file-preview")
                with (evidence / "picker-tap-targets.txt").open("a", encoding="utf-8") as receipt:
                    receipt.write(f"preview={preview} after_preview=" +
                                  repr([n.get("text", "") for n in nodes if n.get("text")][-10:]) + "\\n")
                for node in nodes:
                    if (node.get("text", "").strip().casefold() in
                            {"open", "select", "use this file"}
                            and node.get("clickable") == "true"
                            and node.get("bounds")):
                        tap(center(node["bounds"]))
                        break
        if not wait_for_editor(evidence, 35):
            # Preserve a real failure when the picker stays open or import
            # rejects the ZIP; never count a live WebView as successful import.
            nodes = dump_ui(evidence, "import-attempt-final")
            visible = [n.get("text", "") for n in nodes if n.get("text")]
            raise AssertionError("Project did not open after DocumentsUI selection: " + repr(visible[-16:]))
        nodes = dump_ui(evidence, "imported-final")
        if not editor_visible(nodes):
            raise AssertionError("Project editor controls not visible after ZIP import")
        pid = adb("shell", "pidof", package, check=False).stdout.strip()
        if not pid:
            raise AssertionError("Editor process crashed during project import")
        receipt.update({"result": "emulator_zip_import_open_pass", "process": pid})
    finally:
        (evidence / "import-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        capture(evidence)


def selftest() -> None:
    xml = '<?xml version="1.0"?><hierarchy><node text="" bounds="[0,0][100,100]"><node text="Import Essentials Project ZIP" bounds="[10,20][90,60]"/></node></hierarchy>'
    assert locate(entries(xml), "Import Essentials Project ZIP") == (50, 40)
    assert locate(entries(xml), "missing") is None
    picker_xml = '<?xml version="1.0"?><hierarchy><node resource-id="com.android.documentsui:id/item_root" bounds="[10,20][110,220]"><node text="EssentialsSynthetic.zip"/></node></hierarchy>'
    assert picker_file_card(picker_xml, "EssentialsSynthetic.zip") == (60, 120)
    assert picker_file_card(picker_xml, "other.zip") is None
    # Real API30 DocumentsUI grid: the ZIP nameplate is at y=1139..1190,
    # while the card midpoint y=952 was not accepted by the provider.
    grid_xml = ('<?xml version="1.0"?><hierarchy>'
                '<node resource-id="com.android.documentsui:id/item_root" bounds="[58,646][535,1259]">'
                '<node resource-id="android:id/title" text="EssentialsSynthetic.zip" '
                'bounds="[195,1139][498,1190]"/></node></hierarchy>')
    assert picker_file_card(grid_xml, "EssentialsSynthetic.zip") == (346, 1164)
    list_toggle_xml = ('<?xml version="1.0"?><hierarchy>'
                       '<node resource-id="com.android.documentsui:id/sub_menu_list" '
                       'content-desc="List view" bounds="[890,499][1017,625]"/>'
                       '</hierarchy>')
    assert picker_list_view_control(entries(list_toggle_xml)) == (953, 562)
    list_xml = ('<?xml version="1.0"?><hierarchy>'
                '<node resource-id="com.android.documentsui:id/item_root" '
                'class="android.widget.LinearLayout" bounds="[0,641][1080,830]">'
                '<node resource-id="android:id/title" text="EssentialsSynthetic.zip" '
                'bounds="[189,685][620,742]"/></node></hierarchy>')
    assert picker_file_card(list_xml, "EssentialsSynthetic.zip") == (540, 735)
    assert picker_list_row_icon(list_xml, "EssentialsSynthetic.zip") == (80, 735)
    assert picker_list_row_icon(list_xml, "missing.zip") is None
    # Exact clickable preview action observed in real AOSP API30 evidence.
    preview_xml = ('<?xml version="1.0"?><hierarchy>'
                   '<node resource-id="com.android.documentsui:id/preview_icon" '
                   'content-desc="Preview the file EssentialsSynthetic.zip" '
                   'clickable="true" bounds="[891,641][1080,830]"/>'
                   '</hierarchy>')
    assert picker_preview_control(entries(preview_xml), "EssentialsSynthetic.zip") == (985, 735)
    assert picker_preview_control(entries(preview_xml), "other.zip") is None
    assert picker_preview_control(entries(preview_xml.replace('clickable="true"', 'clickable="false"')),
                                  "EssentialsSynthetic.zip") is None
    assert picker_list_row_icon(grid_xml, "EssentialsSynthetic.zip") is None
    assert picker_list_view_control(entries(grid_xml)) is None
    assert not editor_visible(entries(xml))
    assert not documents_ui_visible(entries(xml))
    picker_visible_xml = ('<?xml version="1.0"?><hierarchy>'
                          '<node package="com.android.documentsui" text="Recent" bounds="[0,0][200,80]"/>'
                          '</hierarchy>')
    assert documents_ui_visible(entries(picker_visible_xml))
    editor_xml = '<?xml version="1.0"?><hierarchy><node text="Essentials Studio — Project" bounds="[0,0][400,60]"/><node text="Export ZIP..." bounds="[0,70][400,140]"/></hierarchy>'
    assert editor_visible(entries(editor_xml))
    app_anr = ('<?xml version="1.0"?><hierarchy>'
               '<node text="Essentials Studio Mobile isn\'t responding" bounds="[0,0][80,60]"/>'
               '</hierarchy>')
    try:
        reject_editor_anr(entries(app_anr))
    except AssertionError:
        pass
    else:
        raise AssertionError("The emulator must reject editor ANR dialogs")

    anr_xml = ('<?xml version="1.0"?><hierarchy>'
               '<node text="Process system isn\'t responding" bounds="[0,0][100,30]"/>'
               '<node text="Close app" bounds="[10,30][90,50]"/>'
               '<node text="Wait" bounds="[10,60][90,100]"/></hierarchy>')
    assert system_anr_wait_button(entries(anr_xml)) == (50, 80)
    # The macOS AOSP emulator run 41094049109 exposed an ANR in
    # com.android.systemui, which the earlier strict matcher missed.
    assert system_anr_wait_button(entries(anr_xml.replace(
        "Process system", "System UI"))) == (50, 80)
    assert system_anr_wait_button(entries(anr_xml.replace(
        "Process system", "com.android.systemui"))) == (50, 80)
    assert system_anr_wait_button(entries(editor_xml)) is None
    assert system_anr_wait_button(entries(anr_xml.replace("system", "Essentials Studio"))) is None
    try:
        center("[0,0][0,10]")
    except ValueError:
        pass
    else:
        raise AssertionError("Empty bounds accepted")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--package")
    parser.add_argument("--evidence", type=Path, default=Path("android-runtime-evidence"))
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--recover-system-anr", action="store_true")
    options = parser.parse_args()
    if options.self_test:
        selftest()
        print("Accessibility selector self-tests passed")
        return 0
    if options.recover_system_anr:
        return 0 if recover_system_anr(options.evidence) else 1
    if not options.fixture or not options.package:
        parser.error("--fixture and --package are required")
    try:
        smoke(options.fixture, options.evidence, options.package)
    except Exception as exc:
        print(f"Android emulator import NOT verified: {exc}")
        return 1
    print("Synthetic ZIP imported and opened on Android emulator")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
