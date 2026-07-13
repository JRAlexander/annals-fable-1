#!/usr/bin/env bash
# Determinism wall for the headless layers: no ambient randomness, wall-clock,
# or DOM. All randomness must come from named sfc32 streams (core/rng.ts).
set -euo pipefail
cd "$(dirname "$0")/.."

dirs=()
for d in src/core src/content src/worldgen src/sim; do
  [ -d "$d" ] && dirs+=("$d")
done
[ ${#dirs[@]} -eq 0 ] && { echo 'purity-check: no headless dirs yet'; exit 0; }

if grep -rnE 'Math\.random|Date\.now|performance\.now|\bwindow\b|\bdocument\b|\bnavigator\b|\blocalStorage\b' "${dirs[@]}"; then
  echo 'purity-check: FORBIDDEN API used in a headless layer (see matches above)' >&2
  exit 1
fi
echo 'purity-check: ok'
