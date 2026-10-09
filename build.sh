#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
node scripts/bundle-icons.mjs
python3 - <<'PY'
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path.cwd()
src = root / 'src'
catalog = json.loads((src / 'content/reading-skill-assets.json').read_text())
# Original illustration sources are retained in the workspace, not shipped.
source_only = {
    'marmoset-front-detailed.svg', 'marmoset-vector-clean.svg', 'image.png',
    'content/puffin-cartoon.svg', 'content/icons/marmoset-reference.svg',
}
assets = [(src / path, str(path)) for path in sorted(p.relative_to(src) for p in src.rglob('*') if p.is_file() and not any(part.startswith('.') for part in p.relative_to(src).parts)) if path.as_posix() not in source_only]
assets.extend((root / name, name) for name in ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
for relative in catalog['files']:
    source = root / 'skills' / relative
    if not source.is_file():
        raise SystemExit('Missing original skill resource: ' + str(source))
    assets.append((source, 'skills/' + relative))
with ZipFile(root / 'abstractin.xpi', 'w', ZIP_DEFLATED) as archive:
    for source, target in assets:
        archive.write(source, target)
print('Built ' + str(root / 'abstractin.xpi'))
PY
