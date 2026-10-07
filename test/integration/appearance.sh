#!/bin/bash
# ZOTERO_BIN=/path/to/zotero bash test/integration/appearance.sh
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
profile_root=$(mktemp -d /tmp/abstractin-appearance-XXXXXX)
out="${APPEARANCE_OUT:-$repo/test/integration/out/appearance}"
mkdir -p "$profile_root/profile/extensions" "$profile_root/data" "$out"
rm -f "$out/results.json"
echo "${ABSTRACTIN_SOURCE:-$repo/src}" > "$profile_root/profile/extensions/abstractin@shen-zhang-42.github.io"
echo "$repo/test/integration/appearance" > "$profile_root/profile/extensions/abstractin-tester@shen-zhang-42.github.io"
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
PREFS
if [ -n "${CATALOG_FIXTURE:-}" ]; then
 python3 - "$profile_root/profile/user.js" "$CATALOG_FIXTURE" <<'PYTEST'
import json, sys
with open(sys.argv[1], 'a') as prefs:
 prefs.write('user_pref("extensions.abstractin-tester.catalogFixture", ' + json.dumps(sys.argv[2]) + ');\n')
PYTEST
fi
timeout 60 env MOZ_HEADLESS=1 MOZ_HEADLESS_WIDTH=1000 MOZ_HEADLESS_HEIGHT=900 "${ZOTERO_BIN:-zotero}" -profile "$profile_root/profile" -no-remote -ZoteroDebugText > "$out/zotero-debug.log" 2>&1 || true
node - "$out/results.json" <<'JS'
const fs = require('node:fs');
const results = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const failed = results.checks.filter(check => !check.ok);
console.log(JSON.stringify({checks: results.checks.length, failed, errors: results.errors}, null, 2));
process.exit(failed.length || results.errors.length ? 1 : 0);
JS
