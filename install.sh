#!/bin/sh
# Install, update, or uninstall pi-launch.
#   Install:   curl -fsSL https://raw.githubusercontent.com/scottmonster/pi-launch/HEAD/install.sh | sh
#   Update:    pi launch update      (or: pi-launch --update)
#   Uninstall: pi launch uninstall   (or: pi-launch --uninstall)
# Extra arguments are passed to the installer/uninstaller (e.g. --keep-other-pi, --no-restore).
set -eu

# Wrapped in a function so sh parses the whole file before `git pull` can change it.
main() {
  repo="${PI_LAUNCH_REPO:-https://github.com/scottmonster/pi-launch.git}"
  managed="${XDG_DATA_HOME:-$HOME/.local/share}/pi-launch/src"
  dir="${PI_LAUNCH_DIR:-$managed}"
  PATH="$PATH:$HOME/.bun/bin"

  for tool in git bun; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is required (Bun: https://bun.sh)"
  done
  bun -e 'process.exit(typeof process.execve === "function" ? 0 : 1)' ||
    fail "Bun 1.3+ is required (found $(bun --version)); run: bun upgrade"

  if [ "${1:-}" = "--uninstall" ]; then
    shift
    [ -d "$dir" ] || fail "no pi-launch checkout at $dir"
    bun "$dir/scripts/uninstall-user.mjs" "$@"
    # Only delete the standard install checkout, never a development clone.
    if [ -d "$managed" ] && [ "$(cd "$dir" && pwd -P)" = "$(cd "$managed" && pwd -P)" ]; then
      rm -rf "$dir"
      rmdir "$(dirname "$dir")" 2>/dev/null || true
    else
      echo "Kept development checkout $dir"
    fi
    return
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
  bun install --frozen-lockfile --production --ignore-scripts --silent
  bun scripts/install-user.mjs "$@"
}

fail() { echo "pi-launch: $*" >&2; exit 1; }

main "$@"
