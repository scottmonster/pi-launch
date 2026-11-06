# pi-launch

Launches [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) and lets
its `settings.json` files contain comments and trailing commas, keeping your
comments when Pi saves settings.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/scottmonster/pi-launch/HEAD/install.sh | sh
```

Requires Linux/macOS, git, and [Bun](https://bun.sh) 1.3+. Open a new terminal afterwards.

## Update

```sh
pi launch update        # or: pi-launch --update
```

This updates pi-launch. Update Pi itself with `pi update`.

## Uninstall

```sh
pi launch uninstall     # or: pi launch remove, pi-launch --uninstall, pi-launch --remove
```

Restores plain Pi and converts `~/.pi/agent/settings.json` back to plain JSON.

## How installation works

pi-launch is cloned to `~/.local/share/pi-launch/src`. Compatibility is checked
by behavior, not by a version allowlist (tested with Pi 1.4.0 and 1.5.0).

The goal is that **pi-launch is the only `pi` any program can find**, whatever its
PATH order. The installer:

1. Installs the real Pi with Bun (`bun install -g --ignore-scripts`) into a private
   Bun global directory that is never on PATH: `~/.local/share/pi-launch/pi`
   (same version as your existing Pi, else latest).
2. Verifies settings compatibility before changing anything else.
3. Writes `~/.local/bin/pi` and `~/.local/bin/pi-launch` as small shell shims that
   point at the private directory (independent of `XDG_*` variables) and run
   `bun` from PATH, falling back to the Bun the installer used. They refuse to
   overwrite unrelated executables.
4. Uninstalls every other npm or Bun Pi on PATH (e.g. nvm's global
   `@earendil-works/pi-coding-agent`) so nothing can shadow the wrapper.
   Pass `--keep-other-pi` to skip this (`... | sh -s -- --keep-other-pi`).
5. Adds an idempotent PATH block for `~/.local/bin` to `~/.zshrc`, `~/.bashrc`,
   `~/.profile` and `$ZDOTDIR/.zshrc` (backups: `<file>.before-pi-launch`).

Your settings, sessions and Pi packages in `~/.pi` are not touched.
If you later install Pi globally again, the wrapper warns on every launch; run
`pi launch update` to remove it.

## Usage

Use `pi` normally. Every argument is passed through unchanged, including package
commands, CLI updates, print mode, and RPC mode started through this CLI.
`pi-launch` is an equivalent explicit command. `pi launch ...` is reserved for
pi-launch's own commands (`pi launch help` lists them).

```jsonc
{
  // Preferred appearance
  "theme": "dark",
  "compaction": {
    /* Reserved response budget */
    "reserveTokens": 16384,
  },
}
```

Both user and project `settings.json` files accept `//` comments, `/* */` comments,
and trailing commas. Ordinary strings containing URLs or comment-like text are
unchanged. Existing comments are preserved during object-property updates;
comments inside removed properties or replaced arrays/values may be lost.

## Bypass

If pi-launch itself misbehaves, run the same private Pi without the wrapper:

```sh
pi --bypass ...            # first argument only
PI_LAUNCH_BYPASS=1 pi ...  # for programs that launch pi for you
```

Bypass is handled in the shell shim, so it works even if this checkout is broken.
It skips the settings adapter and compatibility check: plain Pi can't read
commented settings, so it reports a settings error and runs with defaults for
that file (it does not overwrite it).

## Forwarding and discovery

The wrapper always runs the Pi in its private prefix (`PI_LAUNCH_PREFIX`, set by the
shim). For testing, `PI_LAUNCH_REAL_PI=/path/to/pi` overrides this.

Pi runs under Bun through its own Bun entry point (`dist/bun/cli.js`), which sets
up Bun-specific OAuth, Bedrock and QuickJS support.

Normal runs use `execve`, not a child-process proxy. Arguments, environment,
working directory, stdin/stdout/stderr, terminal access, signals and exit status
are inherited directly. Update commands are supervised with inherited stdio and
signal forwarding so the launcher can verify the installation afterward.
It starts Pi's **unbundled CLI** after installing the settings adapter, rather
than executing its default bundled entry point. Direct SDK imports or another
application's embedded/bundled Pi are not patched.

## Updates and compatibility

`pi update` runs with `BUN_INSTALL` pointed at the private directory, so Pi's
own `bun install -g` updates it in place and never creates a competing `pi` on
PATH. Your regular Bun global directory (`~/.bun`) is not used.

### Automatic compatibility verification

On every launch, the wrapper fingerprints the Pi npm package metadata and its
JavaScript/JSON distribution files, the launcher adapter/probe sources and lockfile,
and the Bun runtime identity. A changed installation is tested in a separate,
offline Bun process with disposable HOME, agent, and project directories.
The probe checks:

- Global and trusted-project settings with comments and trailing commas load.
- Untrusted project settings are not applied.
- Reading doesn't rewrite settings.
- Top-level, nested, and project-setting writes preserve comments and other values.
- Saved values reload correctly, with no settings errors reported by Pi.

Successful checks are cached atomically in
`${XDG_CACHE_HOME:-~/.cache}/pi-launch/verified/` (override with
`PI_LAUNCH_CACHE_DIR`). Cache misses, damaged records, and adapter changes trigger
a fresh check. Failed checks are never cached as successes. An unwritable cache
means the successful check repeats next time. Diagnostics go to stderr, never
stdout, preserving JSON/RPC output. Delete the cache directory to force retesting.

For `pi update ...`, the current installation must first pass as usual. The
launcher lets the update command run, then rediscovers and checks the resulting
installation—even if the command returned a nonzero status. The update's exit
code is retained. If verification fails after a successful update, that command
still exits 0 but prints a prominent diagnostic; subsequent normal launches are
blocked. Interrupted updates are rechecked on the next launch. Updates outside
this wrapper (e.g. from another terminal) are also detected on the next launch.

A compatible Pi 1.5 or later is accepted automatically. An incompatible one
**stops with an error** before starting the normal CLI. There is no automatic
rollback, no version allowlist to edit, and no silent fallback to ignoring settings
or removing comments. The check does not modify your real settings or install an
update by itself. It tests the settings integration, not every Pi feature; changes
to external dependencies without changes to Pi's distribution or the runtime may
require clearing the cache manually.

If compatibility fails, re-run the install command once a pi-launch fix is
available, use `pi --bypass` meanwhile, or restore a known-working Pi:

```sh
BUN_INSTALL=~/.local/share/pi-launch/pi bun install -g --ignore-scripts @earendil-works/pi-coding-agent@<version>
```

Wrapper commands—including another `pi update`—remain blocked while the installed
settings API is broken.
Native JSONC support upstream remains the long-term way to eliminate this
internal dependency.

Invalid JSONC is reported as an error; the adapter does not repair files or
strip and restore comments on disk. Existing Pi file locks, merging, and trust
checks remain in use. Only settings storage is changed, not other JSON files.

## Uninstall details

The uninstall command reinstalls plain Pi globally at the same version
(`npm install -g --ignore-scripts` if npm is available, else `bun install -g`),
converts `~/.pi/agent/settings.json` to plain JSON (original
saved as `settings.json.pi-launch-backup`), then removes the shims, the private
Pi, the cache, the PATH blocks and the pi-launch checkout. Nothing is removed if
the reinstall fails. Options (e.g. `pi launch uninstall --no-restore`): `--no-restore` (don't
reinstall plain Pi), `--keep-comments` (leave settings as they are). Project
`.pi/settings.json` files with comments must be converted by hand.

## Development

```sh
git clone https://github.com/scottmonster/pi-launch.git && cd pi-launch
bun install
bun test
bun run install-user     # install from this checkout instead of ~/.local/share
bun run uninstall-user   # same as pi launch uninstall, but keeps the checkout
```

Tests cover JSONC parsing and preservation, invalid input, nested edits, no-op
writes, recursion prevention, compatibility errors, argument/environment/stdio
forwarding, working directory, exit status, signals, actual Pi storage, behavior
probes, cache invalidation, and successful/failed simulated updates. No real Pi
update is performed by the tests.
