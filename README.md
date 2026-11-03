# pi-launch

A standalone launcher that exposes `pi` on PATH and enables comment-preserving
JSONC settings. This directory is an independent Git repository, not a Pi extension.

## Install

Requires Linux/macOS, Node **22.15+** (with `process.execve`), and an npm installation
of `@earendil-works/pi-coding-agent`. Compatibility is checked by behavior, not
by a version allowlist. Tested against actual Pi **1.4.0** and simulated compatible
and incompatible **1.5.0** updates. Standalone Pi binaries and arbitrary shell
shims are not supported.

```sh
cd /home/scott/Documents/mipi/utils/pi-launch
npm ci
npm test
npm run install-user
```

The installer:

- Creates `~/.local/bin/pi` and `~/.local/bin/pi-launch` symlinks to this checkout.
- Refuses to overwrite unrelated executables.
- Appends an idempotent PATH block to `~/.zshrc`, `~/.bashrc`, and `~/.profile`,
  plus `$ZDOTDIR/.zshrc` when configured.
  Originals are backed up once as `<file>.before-pi-launch`.
- Does not modify your Pi installation or settings.

Open a new terminal, or activate in the current shell:

```sh
export PATH="$HOME/.local/bin:$PATH"
rehash 2>/dev/null || hash -r
pi --version
```

Keep this checkout in place; the installed links point here. Run the installer
again if you move it (remove the old dangling links first).

## Usage

Use `pi` normally. Every argument is passed through unchanged, including package
commands, CLI updates, print mode, and RPC mode started through this CLI.
`pi-launch` is an equivalent explicit command.

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

## Forwarding and discovery

On every launch, the wrapper searches PATH for the first executable named `pi`
that is not itself (including symlink aliases). It locates the npm package from
that executable and checks compatibility before loading anything. No NVM version
or global npm directory is hardcoded. If needed, specify a real executable:

```sh
PI_LAUNCH_REAL_PI=/path/to/node/bin/pi pi --version
```

Do not point that override at the wrapper. There is no implicit fallback to a
second Pi installation if the first real executable is incompatible.

Normal runs use `execve`, not a child-process proxy. Arguments, environment,
working directory, stdin/stdout/stderr, terminal access, signals and exit status
are inherited directly. Update commands are supervised with inherited stdio and
signal forwarding so the launcher can verify the installation afterward.
It starts Pi's **unbundled CLI** after installing the settings adapter, rather
than executing its default bundled entry point. Direct SDK imports or another
application's embedded/bundled Pi are not patched.

## Updates and compatibility

The launcher and its symlinks live outside Pi's npm installation, so Pi updates
do not overwrite them. New launches rediscover the current Pi installation.
Normal Pi update/install/configuration commands still work through the wrapper.
If a Node-version switch changes PATH order, ensure `~/.local/bin` is first again.

### Automatic compatibility verification

On every launch, the wrapper fingerprints the Pi npm package metadata and its
JavaScript/JSON distribution files, the launcher adapter/probe sources and lockfile,
and the Node runtime identity. A changed installation is tested in a separate,
offline Node process with disposable HOME, agent, and project directories.
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
this wrapper (e.g. npm or another terminal) are also detected on the next launch.

A compatible Pi 1.5 or later is accepted automatically. An incompatible one
**stops with an error** before starting the normal CLI. There is no automatic
rollback, no version allowlist to edit, and no silent fallback to ignoring settings
or removing comments. The check does not modify your real settings or install an
update by itself. It tests the settings integration, not every Pi feature; changes
to external dependencies without changes to Pi's distribution or the runtime may
require clearing the cache manually.

If compatibility fails, update this repository separately (`git pull`, then
`npm ci` and `npm test`) when a fix is available, or use your external package
manager to restore a known-working Pi installation. Wrapper commands—including
another `pi update`—remain blocked while the installed settings API is broken.
Native JSONC support upstream remains the long-term way to eliminate this
internal dependency.

Invalid JSONC is reported as an error; the adapter does not repair files or
strip and restore comments on disk. Existing Pi file locks, merging, and trust
checks remain in use. Only settings storage is changed, not other JSON files.

## Development

```sh
npm test
```

Tests cover JSONC parsing and preservation, invalid input, nested edits, no-op
writes, recursion prevention, compatibility errors, argument/environment/stdio
forwarding, working directory, exit status, signals, actual Pi storage, behavior
probes, cache invalidation, and successful/failed simulated updates. No real Pi
update is performed by the tests.

## Uninstall

Remove the `~/.local/bin/pi` and `~/.local/bin/pi-launch` links and the marked
`pi-launch` PATH blocks from your shell startup files. **Remove comments and
trailing commas from settings before using unwrapped Pi again.** To bypass the
wrapper temporarily, invoke the real Pi by absolute path, but only with plain
JSON settings. No Git remote is configured automatically.
