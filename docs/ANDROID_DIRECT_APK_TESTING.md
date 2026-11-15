# Direct Android APK testing (no paid runners)

Use three **independent** lanes. Do not report an APK as fully accepted merely
because a frontend build succeeds or an emulator screenshot exists.

## Lane 1: real Android x86_64 emulator (automatic, free GitHub Actions)

[Android native emulator UI smoke](../.github/workflows/android-emulator-ci.yml)
builds the PR source for x86_64, checks the runner's actual /dev/kvm
availability, boots an API35 emulator, installs and launches the APK, navigates
Android DocumentsUI, imports a rights-cleared synthetic RMXP project, tests
portrait and landscape navigation, and uploads screenshots, accessibility
hierarchies and a JSON receipt. It has passed for PR #97 at head
`8733a55ee384109007553120d8b9853a6fe57d97` on run
[43705622934](https://github.com/xbaconator9000x/Essentials-Studio-Mobile/actions/runs/43705622934).

This verifies the **x86_64 emulator build**, not the separate ARM64 APK. The
current smoke does **not** edit map/event/sprite pixels or prove an Android
Save All -> ZIP export -> reimport cycle. Those require additional scripted
UI checks, captured before and after actual app state changes.

## Lane 2: real ARM64 device over ADB (no emulator/KVM)

`scripts/android-physical-arm64-smoke.py` is a local-only independent check
for the **same ARM64 APK artifact** that a user installs on their phone. It
can be run from Windows, macOS or Linux and requires Python 3 plus the free
[Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools).

1. Download the **ARM64 APK** from the matching PR #97 **Android APK probe**
   Actions artifact, and extract the ZIP. Verify the artifact/run belongs to
   the target commit.
2. Enable **Developer options -> USB debugging** on the phone. Connect by
   USB or Android's secure Wi-Fi pairing. Approve the device-side prompt.
3. On the computer, check `adb devices -l`; it must show an authorized
   `device` state, not `offline` or `unauthorized`.
4. From the repository folder, run:

   ```sh
   python scripts/android-physical-arm64-smoke.py "/path/to/arm64-debug.apk"
   ```

   On Windows, use `py -3` if `python` is not installed in PATH.
   If more than one device is connected, specify `--serial SERIAL`.
   To control output location, use `--evidence local-evidence-folder`.

The script checks the connected device's ABI/API, hashes the APK, installs
it without uninstalling the previous app, launches it, requires genuine
app-owned accessibility UI, and captures a real screenshot and a JSON
receipt. **No screen/video/data is sent to GitHub.** Its local output may
include device IDs or project names; review/redact before sharing. Signature
mismatches must fail; the script must never silently uninstall the app or
delete its project data to make an APK pass. This checks installation and
runtime UI, **not** editing/export acceptance. The on-device Save All/ZIP
test requires separate explicit procedures and file/hash checks.

## Lane 3: independent cloud-hosted physical Android (optional, no cost quota)

Firebase Test Lab's Spark plan currently advertises **five physical-device
tests/day** and **ten virtual-device tests/day**, without a payment method
(verify current pricing before using). This provides independent physical
hardware without a phone connected to the development environment:

- Official quotas: https://firebase.google.com/docs/test-lab/usage-quotas-pricing
- Official no-cost pricing: https://firebase.google.com/pricing

Set up this lane **only** with explicit consent and a user-controlled Firebase
project. Do not connect a billing-enabled Blaze project or exceed no-cost
quotas. A Robo test can probe startup/navigation; a targeted instrumentation
test is needed to certify Save All/export. Firebase is not configured by
this repository change and no such physical Test Lab pass is claimed.

## Release acceptance: different evidence for different claims

| Claim | Required independent evidence |
| --- | --- |
| Compiles/packaged | Successful TypeScript/Rust/Gradle build and APK checksum |
| Android emulator works | ADB install, foreground app, actual screenshot and XML |
| ARM64 APK works | ARM64 hardware install and app-owned UI screenshot/receipt |
| Project edit is persisted | Edit -> Save All -> close -> reopen -> compare bytes/values |
| Export/reimport is lossless | Native SAF exported ZIP -> independent hash/entry audit -> reimport |
| Physical phone UX works | Touch, rotation, keyboard, save/cancel and crash check on hardware |

The runtime emulator and physical-device acceptance gates are separate from
source/build tests. No proprietary Shattered assets, saves, or source ROMs may
be uploaded as public CI fixtures. Previous deferred Android runs are not
counted as passes.
