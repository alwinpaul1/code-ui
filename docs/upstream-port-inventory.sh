#!/bin/sh
# Which upstream commits since the vendor base can reach the phone?
# A commit reaches the phone when it changes a file under mobile/, or a file
# under src/shared/ that mobile/ imports. Run from the repo root with ORCA
# pointing at an Orca clone. Quote every rev: unquoted, zsh's :s modifier
# corrupts "$REV:path" and you end up diffing an error message.
set -eu
ORCA=${ORCA:?set ORCA to an Orca clone}
BASE=$(sed -n 's/^orca upstream commit: //p' UPSTREAM.txt)
grep -rhoE "\.\./\.\./\.\./src/shared/[A-Za-z0-9._/-]+" mobile/src mobile/app |
  sed 's|.*/src/shared/||; s/\.js$//' | sort -u > /tmp/codeui-imported-shared.txt
git -C "$ORCA" log --reverse --format='%h|%s' "$BASE..origin/main" -- mobile/ src/shared/
