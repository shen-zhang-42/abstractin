#!/bin/bash
# ZOTERO_BIN=/path/to/zotero bash test/integration/composer.sh
# Uses an empty library and separate profile under /tmp.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
profile_root=$(mktemp -d /tmp/abstractin-composer-XXXXXX)
out="${COMPOSER_OUT:-$repo/test/integration/out/composer}"
mkdir -p "$profile_root/profile/extensions" "$profile_root/data" "$out"
rm -f "$out/results.json"
plugin_source="${ABSTRACTIN_SOURCE:-$repo/src}"
if [[ "$plugin_source" == *.xpi ]]; then
 cp "$plugin_source" "$profile_root/profile/extensions/abstractin@shen-zhang-42.github.io.xpi"
else
 echo "$plugin_source" > "$profile_root/profile/extensions/abstractin@shen-zhang-42.github.io"
fi
echo "${ABSTRACTIN_TESTER:-$repo/test/integration/composer}" > "$profile_root/profile/extensions/abstractin-tester@shen-zhang-42.github.io"
python3 - "$profile_root" "$out" "$repo" <<'PY'
from pathlib import Path
import json, sys
base, out, repo = sys.argv[1:]
prefs = {'extensions.zotero.dataDir': base+'/data', 'extensions.zotero.useDataDir': True,
 'extensions.autoDisableScopes': 0, 'extensions.enabledScopes': 15, 'extensions.startupScanScopes': 15,
 'xpinstall.signatures.required': False, 'extensions.zotero.firstRun2': False,
 'extensions.zotero.firstRunGuidance': False, 'extensions.zotero.sync.autoSync': False,
 'extensions.zotero.httpServer.enabled': False, 'extensions.abstractin.onboarded': True,
 'extensions.abstractin-tester.outDir': out, 'extensions.abstractin-tester.repo': repo}
Path(base, 'profile', 'user.js').write_text('\n'.join('user_pref('+json.dumps(k)+','+json.dumps(v)+');' for k,v in prefs.items()))
PY
timeout 60 env MOZ_HEADLESS=1 MOZ_HEADLESS_WIDTH=1000 MOZ_HEADLESS_HEIGHT=900 "${ZOTERO_BIN:-zotero}" -profile "$profile_root/profile" -no-remote -ZoteroDebugText > "$out/zotero-debug.log" 2>&1 || true
node - "$out/results.json" <<'JS'
const fs = require('node:fs');
const results = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const failed = results.checks.filter(check => !check.ok);
console.log(JSON.stringify({version: results.version, checks: results.checks.length, failed, errors: results.errors}, null, 2));
process.exit(failed.length || results.errors.length ? 1 : 0);
JS
