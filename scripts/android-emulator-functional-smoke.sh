#!/usr/bin/env bash
# Run launch and functional import in one shell. The emulator action runs
# multiline "script:" entries as separate shells, so local variables do not
# survive from one entry to the next.
set -euo pipefail

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
