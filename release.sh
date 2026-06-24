#!/usr/bin/env bash
# Cut a release: build the .xpi, regenerate update.json from manifest.json,
# commit, push, and publish a GitHub release with the .xpi attached.
# Bump "version" in manifest.json first, then run ./release.sh
set -euo pipefail
cd "$(dirname "$0")"

REPO="ievlevpn/zotero-theorem-list"
XPI="theorem-list.xpi"
VER=$(node -p "require('./manifest.json').version")

node test.js
rm -f "$XPI"
zip -q -r "$XPI" manifest.json bootstrap.js

# Regenerate update.json so update_link always points at this version's asset.
REPO="$REPO" node -e '
const fs = require("fs");
const m = require("./manifest.json");
const z = m.applications.zotero;
const repo = process.env.REPO;
const out = { addons: { [z.id]: { updates: [{
  version: m.version,
  update_link: `https://github.com/${repo}/releases/download/v${m.version}/theorem-list.xpi`,
  applications: { zotero: { strict_min_version: z.strict_min_version } },
}] } } };
fs.writeFileSync("update.json", JSON.stringify(out, null, 2) + "\n");
'

git add manifest.json bootstrap.js update.json
git commit -m "Release v$VER" || echo "(nothing to commit)"
git push

gh release create "v$VER" "$XPI" -t "v$VER" \
  -n "Install: download \`theorem-list.xpi\` below, then Zotero → Tools → Plugins → ⚙ → Install Plugin From File…

Existing installs (v0.4.1+) update automatically."

echo "released v$VER"
