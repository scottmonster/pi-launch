#!/bin/sh
# Install, update, or uninstall pi-launch.
#   Install / update: curl -fsSL https://raw.githubusercontent.com/scottmonster/pi-launch/HEAD/install.sh | sh
#   Uninstall:        curl -fsSL https://raw.githubusercontent.com/scottmonster/pi-launch/HEAD/install.sh | sh -s -- --uninstall
# Extra arguments are passed to the installer/uninstaller (e.g. --keep-other-pi, --no-restore).
set -eu

repo="${PI_LAUNCH_REPO:-https://github.com/scottmonster/pi-launch.git}"
dir="${PI_LAUNCH_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/pi-launch/src}"

fail() { echo "pi-launch: $*" >&2; exit 1; }
for tool in git node npm; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is required"
done
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 15) ? 0 : 1)' ||
  fail "Node 22.15+ is required (found $(node --version))"

if [ "${1:-}" = "--uninstall" ]; then
  shift
  [ -d "$dir" ] || fail "no pi-launch checkout at $dir"
  node "$dir/scripts/uninstall-user.mjs" "$@"
  rm -rf "$dir"
  rmdir "$(dirname "$dir")" 2>/dev/null || true
  exit 0
fi

if [ -d "$dir/.git" ]; then
  echo "Updating pi-launch in $dir"
  git -C "$dir" pull --ff-only --quiet
else
  echo "Installing pi-launch into $dir"
  mkdir -p "$(dirname "$dir")"
  git clone --quiet --depth 1 "$repo" "$dir"
fi
cd "$dir"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
node scripts/install-user.mjs "$@"
