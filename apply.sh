#!/usr/bin/env bash
set -euo pipefail

PATCH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_VERSION="${TAR_PATCH_VERSION:-0.1.0}"
VERSION_APPLY="$PATCH_ROOT/versions/$PATCH_VERSION/apply.sh"

if [[ ! -x "$VERSION_APPLY" ]]; then
  echo "ERROR=Patch version $PATCH_VERSION is not executable or does not exist: $VERSION_APPLY" >&2
  exit 1
fi

exec "$VERSION_APPLY" "$@"
