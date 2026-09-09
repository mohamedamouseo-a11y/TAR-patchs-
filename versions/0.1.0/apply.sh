#!/usr/bin/env bash
set -euo pipefail

PATCH_VERSION="0.1.0"
EXPECTED_HEAD="c2ad42e3eb9b27830db41a3e6f51ca7179d9b168"
TARGET="${TAR_TARGET_PATH:-/var/www/TAR/source/agent-tars}"
BACKUP_ROOT="${TAR_BACKUP_ROOT:-/var/www/TAR/backups}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCHER="$HERE/patches/0001-developer-hub-source-download.py"
PAYLOAD="$HERE/payload"

fail() {
  echo "PATCH_APPLY_STATUS=BLOCKED" >&2
  echo "ERROR=$1" >&2
  exit 1
}

[[ -d "$TARGET/.git" ]] || fail "Target is not a git working tree: $TARGET"
[[ -f "$PATCHER" ]] || fail "Patch script missing: $PATCHER"
[[ -d "$PAYLOAD" ]] || fail "Patch payload missing: $PAYLOAD"

HEAD="$(git -C "$TARGET" rev-parse HEAD)"
[[ "$HEAD" == "$EXPECTED_HEAD" ]] || fail "Upstream mismatch. Expected $EXPECTED_HEAD, got $HEAD"

PACKAGE_VERSION="$(node -e "const p=require(process.argv[1]); process.stdout.write(String(p.version||''))" "$TARGET/multimodal/agent-tars/cli/package.json")"
[[ "$PACKAGE_VERSION" == "0.3.0" ]] || fail "Agent TARS version mismatch. Expected 0.3.0, got $PACKAGE_VERSION"

TOUCHED=(
  "multimodal/tarko/agent-server/src/api/routes/system.ts"
  "multimodal/tarko/agent-ui/src/standalone/app/App.tsx"
  "multimodal/tarko/agent-ui/src/standalone/navbar/Navbar.tsx"
  "multimodal/tarko/agent-ui/src/standalone/home/WelcomePage.tsx"
)

for rel in "${TOUCHED[@]}"; do
  [[ -f "$TARGET/$rel" ]] || fail "Expected target file missing: $rel"
  if ! git -C "$TARGET" diff --quiet -- "$rel"; then
    fail "Target file has local modifications before patch: $rel"
  fi
done

NEW_FILES=(
  "multimodal/tarko/agent-server/src/api/controllers/developerHub.ts"
  "multimodal/tarko/agent-ui/src/standalone/developer/DeveloperHub.tsx"
  "multimodal/tarko/agent-ui/src/standalone/developer/DeveloperHubSettingsButton.tsx"
)

for rel in "${NEW_FILES[@]}"; do
  [[ ! -e "$TARGET/$rel" ]] || fail "Patch target already exists: $rel"
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PATH="$BACKUP_ROOT/tar-patch-${PATCH_VERSION}-${STAMP}"
mkdir -p "$BACKUP_PATH"

for rel in "${TOUCHED[@]}"; do
  mkdir -p "$BACKUP_PATH/$(dirname "$rel")"
  cp -a "$TARGET/$rel" "$BACKUP_PATH/$rel"
done

cat > "$BACKUP_PATH/PATCH_BACKUP_MANIFEST.txt" <<EOF
PATCH_VERSION=$PATCH_VERSION
UPSTREAM_COMMIT=$HEAD
TARGET=$TARGET
CREATED_AT=$STAMP
EOF

rollback() {
  set +e
  echo "ROLLBACK_STATUS=STARTED" >&2
  for rel in "${TOUCHED[@]}"; do
    if [[ -f "$BACKUP_PATH/$rel" ]]; then
      mkdir -p "$TARGET/$(dirname "$rel")"
      cp -a "$BACKUP_PATH/$rel" "$TARGET/$rel"
    fi
  done
  for rel in "${NEW_FILES[@]}"; do
    rm -f "$TARGET/$rel"
  done
  rmdir "$TARGET/multimodal/tarko/agent-ui/src/standalone/developer" 2>/dev/null || true
  echo "ROLLBACK_STATUS=COMPLETE" >&2
}

on_error() {
  local code=$?
  trap - ERR
  rollback
  echo "PATCH_APPLY_STATUS=ROLLED_BACK" >&2
  exit "$code"
}
trap on_error ERR

python3 "$PATCHER" "$TARGET" "$PAYLOAD"

# Deterministic post-apply checks. Do not build or restart here; the execution agent does that after acceptance checks.
grep -q "developerHubController" "$TARGET/multimodal/tarko/agent-server/src/api/routes/system.ts"
grep -q "path=\"/developer-hub\"" "$TARGET/multimodal/tarko/agent-ui/src/standalone/app/App.tsx"
grep -q "DeveloperHubSettingsButton" "$TARGET/multimodal/tarko/agent-ui/src/standalone/navbar/Navbar.tsx"
grep -q "DeveloperHubSettingsButton" "$TARGET/multimodal/tarko/agent-ui/src/standalone/home/WelcomePage.tsx"

trap - ERR

printf '%s\n' \
  "PATCH_VERSION=$PATCH_VERSION" \
  "UPSTREAM_COMMIT=$HEAD" \
  "BACKUP_PATH=$BACKUP_PATH" \
  "PATCH_APPLY_STATUS=APPLIED" \
  "NEXT_GATE=Settings -> Developer Hub -> Download Source Code"
