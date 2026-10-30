# Latest follow-up — 2026-10-30

## Clean cold-boot follow-up: install blocked by guest services

Fresh AVD, explicit -no-snapshot-load -no-snapshot-save, one bounded boot/install process. ADB reached device; sys.boot_completed eventually returned 1. Guest ABI list includes x86_64,x86,arm64-v8a,armeabi-v7a,armeabi: ARM support is advertised, but app binary compatibility remains unverified.

Actual APK installation attempts failed before app launch: initially no package service; later settings-provider-not-initialised, StorageManager.getVolumes() null, and broken service pipe. Diagnostic logcat records BOOT FAILURE starting StorageStatsService with NullPointerException and missing mount service, with repeated system-service startup. Thus this is a guest provisioning/service failure, not evidence of an Essentials app bug. Stopped the unhealthy emulator after collecting logs; final emulator exit -11 was observed after the stop request and is not independently attributed to a spontaneous crash.

No successful APK install, launch, import/edit/save/export/reopen. Screenshot of editor unavailable. Prior pending-snapshot error was avoided by the clean instance; storage/package service failure is the current blocker. Do not equate boot_completed=1 with a usable Android guest.

---

# Work Android runtime probe — 2026-10-30

## Actual provisioning and execution
- Work Linux x86-64 container has no /dev/kvm or preinstalled ADB/emulator.
- Downloaded official Google emulator 37.2.13 (16740729), platform-tools 37.0.1 and API30 google_apis x86_64 r16 image. Installed missing host library privately. Emulator --version executes.
- Started headless emulator with -accel off and SwiftShader. Real ADB progression: no device -> emulator-5570 offline -> emulator-5570 device. Android system_server/SystemUI and WebView service startup were observed in real logcat. This is actual guest execution, not APK execution.
- Boot completion property did not become 1 within the initial approximately five-minute probe. No app installation was attempted in that first probe.
- Extended install-ready retry hit fatal emulator state: `A snapshot operation for 'Runtime' is pending and timeout has expired. Exiting...`; no device available in final attempt. This is an environment/runtime provisioning blocker, not an application defect.

## Artifact inspected
Existing prototype APK SHA256 cb330e0f3b7c4edb2f06b89745ff493f14a97a3801aebfad7b2ec4b61ce02fde; 135970145 bytes; only lib/arm64-v8a/libessentials_studio_lib.so. Exact source revision of this Library prototype is not established. Do not call it latest main. ARM translation compatibility was not established because app install never completed.

## Feature classification
Import, layers, events, PBS, save, SAF export and reopen: implemented/integrated in varying source scopes tracked by queue, but NONE runtime verified by this probe. Collision editing support and fidelity remain unverified. App installed: no. App launched: no. Gameplay/physical-device success: no. No app screenshot because no app launch occurred. CI remains supporting evidence only.

## Follow-up
Resolve emulator pending-snapshot state in an execution environment with stable long-lived VM state, preferably hardware acceleration, or use an authorised connected Android environment. Then install exact main candidate, launch, import representative project, edit, export/reimport and compare unchanged member hashes. Do not repeatedly rebuild APKs while blocked before installation. Continue independent validated source work. Full private v0.4 test archive is available; do not ask user to resupply it.
