#!/usr/bin/env bash
# Run launch and functional import in one shell. The emulator action runs
# multiline "script:" entries as separate shells, so local variables do not
# survive from one entry to the next.
set -euo pipefail

# AOSP on this accelerated host is still scheduling first-boot system
# services when boot_completed=1. A short idle window avoids measuring an
# overloaded boot as an editor import failure; app ANRs still fail closed.
sleep 25
bash scripts/android-emulator-smoke.sh

receipt="android-runtime-evidence/receipt.txt"
test -s "$receipt"
package="$(sed -n 's/^package=//p' "$receipt" | head -n 1)"
if [[ -z "$package" ]]; then
  echo "Android smoke receipt has no package name; cannot verify import" >&2
  exit 1
fi
python3 scripts/android-emulator-import-smoke.py \
  --fixture android-synthetic-fixture/original.zip \
  --package "$package" \
  --evidence android-runtime-evidence

# This second gate uses actual Android touch input and Save All, then reads
# Map001.rxdata from the debug app sandbox and checks the original ZIP hash.
# Do not confuse this with physical ARM64 SAF export or desktop reopening.
python3 scripts/android-emulator-map-save-smoke.py \
  --package "$package" \
  --evidence android-runtime-evidence

# Third gate: exercise the actual native SAF CREATE_DOCUMENT picker and verify
# exported project members against the original synthetic fixture and the
# map bytes just saved on-device. Physical phone/desktop remain separate.
python3 scripts/android-emulator-saf-export-smoke.py \
  --evidence android-runtime-evidence

# Fourth gate: re-import the actual SAF-created ZIP through Android DocumentsUI,
# prove a distinct app-private project was created, and compare its saved map.
# Desktop RMXP/JoiPlay and physical ARM64 remain separate acceptance gates.
python3 scripts/android-emulator-export-reimport-smoke.py \
  --package "$package" \
  --evidence android-runtime-evidence
