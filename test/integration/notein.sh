#!/bin/bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ABSTRACTIN_TESTER="$here/notein" COMPOSER_OUT="${NOTEIN_OUT:-$here/out/notein}" bash "$here/composer.sh"
