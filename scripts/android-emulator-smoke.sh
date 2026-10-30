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
  adb shell dumpsys window > "$evidence/windows.txt" 2>&1 || true
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

# The full AOSP API30 image can report sys.boot_completed=1 while first-boot
# dexopt and WebView services still saturate its virtual CPUs. The actual
# 41102608478 trace shows load 15.2, 81% kernel CPU and a 5-second FocusEvent
# ANR before the import UI is touched. Never dismiss or count an app ANR as
# success; start the editor only after the guest has demonstrably settled.
await_guest_idle() {
  local phase="$1" consecutive=0 attempt load boot
  for attempt in $(seq 1 36); do
    boot="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    load="$(adb shell cat /proc/loadavg 2>/dev/null | awk '{print $1}' | tr -d '\r' || true)"
    printf '%s attempt=%s boot=%s load1=%s\n' "$phase" "$attempt" "$boot" "$load" \
      | tee -a "$evidence/guest-idle.txt"
    if [[ "$boot" == "1" && "$load" =~ ^[0-9]+([.][0-9]+)?$ ]] \
       && awk -v value="$load" 'BEGIN { exit !(value < 5.0) }'; then
      consecutive=$((consecutive + 1))
      if [[ "$consecutive" -ge 3 ]]; then
        return 0
      fi
    else
      consecutive=0
    fi
    sleep 10
  done
  echo "Android guest did not settle before $phase; preserving diagnostics." >&2
  return 1
}

adb install -r "$apk"
adb shell pm path "$package" | tee "$evidence/installed-package.txt"
# Ahead-of-time compile this debug package while the emulator is idle; do not
# include first-launch dexopt in the responsiveness acceptance window.
adb shell cmd package compile -m speed -f "$package" \
  > "$evidence/package-compile.txt" 2>&1 || {
    echo "Android package precompilation failed; retaining evidence." >&2
    exit 1
  }
await_guest_idle "pre-launch"
printf 'guest_idle_before_launch=pass\n' >> "$evidence/receipt.txt"
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
recovered_system_anr=0
for attempt in $(seq 1 6); do
  capture
  focus="$(grep 'mCurrentFocus=' "$evidence/windows.txt" | tail -n 1 || true)"
  if [[ "$focus" == *"$package"* && "$focus" != *"Application Not Responding"* ]]; then
    break
  fi
  # AOSP API 30 on overloaded macOS runners can show a transient *system*
  # process ANR over a healthy editor. The real screenshot from run 41037978718
  # shows the standard "Wait" action. Dismiss ONLY that exact OS ANR once,
  # using its accessibility bounds; never dismiss an editor crash or claim
  # success without subsequently proving editor foreground focus.
  # Android's SystemUI ANR uses the process name com.android.systemui
  # (observed in run 41094049109); the older system-process ANR uses
  # "system". Neither may be mistaken for an editor application ANR.
  if [[ "$recovered_system_anr" == 0 && (
        "$focus" == *"Application Not Responding: system"* ||
        "$focus" == *"Application Not Responding: com.android.systemui"*
      ) ]]; then
    if python3 scripts/android-emulator-import-smoke.py --recover-system-anr --evidence "$evidence"; then
      recovered_system_anr=1
      echo "Dismissed transient Android OS ANR; checking editor focus again."
      sleep 12
      continue
    fi
    echo "Android OS ANR could not be safely dismissed; retaining failure evidence." >&2
  fi
  if [[ "$attempt" == 6 ]]; then
    printf 'Editor UI not foreground/usable; current focus: %s\n' "$focus" >&2
    exit 1
  fi
  sleep 5
done
# A brief foreground window can turn into a real application ANR just
# afterwards. The first functional test run caught exactly that state.
# Let Android's WebView settle and recheck both the window and logcat.
sleep 20
capture
focus="$(grep 'mCurrentFocus=' "$evidence/windows.txt" | tail -n 1 || true)"
if [[ "$focus" != *"$package"* || "$focus" == *"Application Not Responding"* ]]; then
  printf 'Editor foreground was lost after settling: %s\n' "$focus" >&2
  exit 1
fi
if grep -Fq "ANR in $package" "$evidence/logcat.txt"; then
  echo "Android reported an ANR in the editor after launch" >&2
  exit 1
fi
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
