#!/usr/bin/env bash
# Android emulator runtime smoke: installs and launches the real compiled editor.
# This is not a physical SAF provider, full-project import, or gameplay test.
set -euo pipefail

evidence="android-runtime-evidence"
mkdir -p "$evidence"
capture() {
  adb logcat -d -v threadtime > "$evidence/logcat.txt" 2>&1 || true
  adb exec-out screencap -p > "$evidence/launch.png" 2>/dev/null || true
  adb shell dumpsys activity activities > "$evidence/activities.txt" 2>&1 || true
  adb shell dumpsys window windows > "$evidence/windows.txt" 2>&1 || true
  adb shell getprop > "$evidence/device-properties.txt" 2>&1 || true
}
trap capture EXIT

apk="$(find src-tauri/gen/android/app/build/outputs/apk -type f -name '*.apk' | sort | head -n 1)"
if [[ -z "$apk" || ! -f "$apk" ]]; then
  echo "No compiled APK found" >&2
  exit 1
fi
aapt_bin="$(find "${ANDROID_HOME:?}/build-tools" -type f -name aapt | sort -r | head -n 1)"
if [[ -z "$aapt_bin" || ! -x "$aapt_bin" ]]; then
  echo "Android aapt is unavailable" >&2
  exit 1
fi
package="$("$aapt_bin" dump badging "$apk" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -n 1)"
if [[ -z "$package" ]]; then
  echo "Could not read package name from APK" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  apk_hash="$(sha256sum "$apk" | awk '{print $1}')"
else
  apk_hash="$(shasum -a 256 "$apk" | awk '{print $1}')"
fi
abi="$(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
if [[ "$abi" != x86_64 ]]; then
  echo "Unexpected emulator ABI: $abi" >&2
  exit 1
fi
{
  printf 'source_sha=%s\n' "${GITHUB_SHA:-unknown}"
  printf 'apk=%s\n' "$apk"
  printf 'apk_sha256=%s\n' "$apk_hash"
  printf 'package=%s\n' "$package"
  printf 'emulator_abi=%s\n' "$abi"
  printf 'android_release=%s\n' "$(adb shell getprop ro.build.version.release | tr -d '\r')"
} | tee "$evidence/receipt.txt"

adb install -r "$apk"
adb shell pm path "$package" | tee "$evidence/installed-package.txt"
adb logcat -c
adb shell monkey -p "$package" -c android.intent.category.LAUNCHER 1 | tee "$evidence/launch-command.txt"

# Wait for the application process, then give its WebView time to initialise.
running=""
for attempt in $(seq 1 20); do
  running="$(adb shell pidof "$package" 2>/dev/null | tr -d '\r' || true)"
  if [[ -n "$running" ]]; then break; fi
  sleep 2
done
if [[ -z "$running" ]]; then
  echo "Editor process never started" >&2
  exit 1
fi
sleep 12
running="$(adb shell pidof "$package" 2>/dev/null | tr -d '\r' || true)"
if [[ -z "$running" ]]; then
  echo "Editor process exited after launch" >&2
  exit 1
fi
# A live process alone is not a successful UI launch. The previous run showed
# the editor behind an Android "Process system isn't responding" modal while
# CI incorrectly reported success. Require the actual editor window to have
# focus, allowing a short settling interval after the emulator boots.
focus=""
for attempt in $(seq 1 6); do
  capture
  focus="$(grep 'mCurrentFocus=' "$evidence/windows.txt" | tail -n 1 || true)"
  if [[ "$focus" == *"$package"* && "$focus" != *"Application Not Responding"* ]]; then
    break
  fi
  if [[ "$attempt" == 6 ]]; then
    printf 'Editor UI not foreground/usable; current focus: %s\n' "$focus" >&2
    exit 1
  fi
  sleep 5
done
if [[ ! -s "$evidence/launch.png" ]]; then
  echo "No Android screenshot was captured" >&2
  exit 1
fi
if ! python3 - "$evidence/launch.png" <<'PY'
import pathlib
import sys
sys.exit(0 if pathlib.Path(sys.argv[1]).read_bytes().startswith(b'\x89PNG\r\n\x1a\n') else 1)
PY
then
  echo "Screenshot is not a PNG" >&2
  exit 1
fi
if grep -q 'FATAL EXCEPTION' "$evidence/logcat.txt"; then
  echo "Android runtime reported a fatal exception after launch" >&2
  exit 1
fi
printf 'launch_process=%s\nresult=emulator_launch_only_pass\n' "$running" | tee -a "$evidence/receipt.txt"
echo "Editor installed and stayed running on the x86_64 Android emulator."
