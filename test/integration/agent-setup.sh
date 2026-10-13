#!/bin/bash
# ZOTERO_BIN=/path/to/zotero bash test/integration/agent-setup.sh
# Real CLI detection/auth-status subprocess; synthetic compatibility response,
# no provider account or requests. Uses a separate, empty Zotero profile.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ABSTRACTIN_TESTER="$here/agent-setup" COMPOSER_OUT="${AGENT_SETUP_OUT:-$here/out/agent-setup}" bash "$here/composer.sh"
