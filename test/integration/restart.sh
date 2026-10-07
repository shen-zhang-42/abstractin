#!/bin/bash
# Install the packaged XPI normally, then restart the same isolated profile twice.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
profile_root=$(mktemp -d /tmp/abstractin-restart-XXXXXX)
out="${RESTART_OUT:-$repo/test/integration/out/restart}"
mkdir -p "$profile_root/profile/extensions" "$profile_root/data" "$out"
cp "${ABSTRACTIN_XPI:-$repo/abstractin.xpi}" "$profile_root/install.xpi"
echo "$repo/test/integration/restart" > "$profile_root/profile/extensions/abstractin-tester@shen-zhang-42.github.io"
cat > "$profile_root/profile/user.js" <<PREFS
user_pref("extensions.zotero.dataDir", "$profile_root/data");
user_pref("extensions.zotero.useDataDir", true);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("extensions.startupScanScopes", 15);
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.zotero.firstRun2", false);
user_pref("extensions.zotero.firstRunGuidance", false);
user_pref("extensions.zotero.sync.autoSync", false);
user_pref("extensions.abstractin.onboarded", true);
user_pref("extensions.abstractin-tester.outDir", "$out");
user_pref("extensions.abstractin-tester.xpi", "$profile_root/install.xpi");
PREFS
for stage in 0 1 2; do
 rm -f "$out/stage-$stage.json"
 timeout 60 env MOZ_HEADLESS=1 MOZ_HEADLESS_WIDTH=1000 MOZ_HEADLESS_HEIGHT=900 "${ZOTERO_BIN:-zotero}" -profile "$profile_root/profile" -no-remote -ZoteroDebugText > "$out/stage-$stage.log" 2>&1 || true
 node - "$out/stage-$stage.json" <<'JS'
const fs = require('node:fs');
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify(r, null, 2));
process.exit(r.checks.some(check => !check.ok) || r.errors.length ? 1 : 0);
JS
 if [ "$stage" = 0 ]; then rm -f "$profile_root/install.xpi"; fi
done
