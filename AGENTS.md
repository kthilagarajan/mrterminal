# AGENTS.md

Guidance for AI agents (and people) working in this repository.

## What this is

MrTerminal is a macOS-first Electron desktop app: a visual workspace for the
terminals a project needs. It does not implement a shell or a terminal
emulator. Each terminal is the user's own login shell in a pty (node-pty),
drawn with xterm.js, arranged with dockview. Windows and Linux are meant to
follow, so avoid macOS-only assumptions outside clearly marked code.

- Bundle id: `com.webtkdev.mrterminal`
- Repository: `kthilagarajan/mrterminal` (private)
- User state: `~/.mrterminal/config.json`

## Commands

```sh
npm install          # also fixes node-pty's spawn-helper permissions
npm run dev          # run with hot reload
npm run typecheck    # tsc for main/preload and for the renderer
npm test             # vitest (script detection, updater)
npm run build        # bundle into out/
npm run dist         # build .dmg and .zip into dist/ (macOS only)
```

Run `npm run typecheck` and `npm test` before committing.

## Layout

```
src/shared/     types.ts (config and IPC shapes), themes.ts. Imported by every side.
src/main/       Electron main process (Node)
  index.ts        window, menu, IPC handlers
  pty.ts          PtyManager: spawns shells, types commands, reports busy/idle
  shellIntegration.ts  startup files that make zsh/bash emit OSC 133 marks
  scripts.ts      detectScripts(): package.json, pyproject.toml, Makefile, ...
  config.ts       ConfigStore: load, normalise, atomic write
  updater.ts      over-the-air updates from GitHub releases
src/preload/    index.ts exposes `window.api`; the only bridge to the renderer
src/renderer/   React UI
  store.ts        single state object + config edits (useSyncExternalStore)
  actions.ts      user-level actions (boot, run a script, menu commands)
  terminals.ts    xterm.js runtimes, kept outside React and dockview
  dock.ts         one dockview per project: panels, tabs, presets, renaming
  presetLayout.ts read / trim the dockview layout stored in a preset (tested)
  PresetDialog.tsx create or edit a preset, with the layout preview
  closed.ts       stack of closed tabs/projects behind "reopen closed"
  appearance.ts   applies theme and font everywhere
  Sidebar.tsx     project cards: running strip, presets, scripts, commands
```

## How the pieces fit

- **The renderer owns the config.** It edits state in `store.ts`, which
  debounces a save to main; main only adds the window bounds. Add a field in
  `shared/types.ts`, give it a default in `normalizeConfig`/`normalizeProject`
  (old config files must keep loading), then use it.
- **A terminal is a `TerminalDef` plus a runtime.** `project.terminals` is the
  source of truth for what is open and is what gets restored. The dockview
  layout only says where they go and is reconciled against that list.
- **Commands are typed into the shell**, not exec'd, so Ctrl-C returns to a
  prompt.
- **"Running" comes from the shell, not from process names.** zsh and bash are
  started through `shellIntegration.ts`, whose startup files source the user's
  own and add hooks that print OSC 133 marks (`C` command starts, `D`/`A`
  prompt is back); `pty.ts` reads them from the output stream. Shells that
  emit no marks fall back to "the foreground process is not a shell", and
  only once a line has been entered: before that, whatever is in the
  foreground was started by the shell's startup files. Never
  treat an open terminal as running: the UI promises that green means a
  command is executing. `shellIntegration.test.ts` runs real shells; set
  `MRT_TEST_ZSH` to test a zsh that is not in `/bin`.
- **A command's identity is `command` + `cwd`.** That pair links a sidebar
  entry to its open terminal, a preset entry to a terminal it can reuse, and an
  alias (`project.aliases`, see `aliasKey`) to a detected script. Use
  `renameCommand` in `dock.ts` to rename; it keeps sidebar and tab in sync.
- **All projects stay mounted.** Inactive workspaces are `visibility: hidden`,
  not `display: none`, so their terminals keep a real size and keep running.
- **Themes** are data in `shared/themes.ts`; the UI reads CSS variables
  (`--bg`, `--panel`, `--accent`, ...). Do not hard-code colours in
  `styles.css`; derive tints with `color-mix`.
- **Renderer security:** sandboxed, context-isolated, no Node. Anything that
  needs the OS goes through a narrow IPC call in `preload/index.ts`.

## Adding a script source

Write a `Detector` in `src/main/scripts.ts`, add it to `DETECTORS`, and add a
case to `scripts.test.ts`. Detectors must tolerate malformed files.

## Releases and updates

Pushing a tag `v<version>` runs `.github/workflows/release.yml` on a macOS
runner and publishes `MrTerminal-<version>-<arch>.dmg` and `.zip`. The tag must
match `version` in `package.json`.

The app is signed ad hoc, not with an Apple Developer certificate. Because of
that:

- Electron's `autoUpdater` / `electron-updater` cannot be used (Squirrel.Mac
  rejects the signature). `updater.ts` downloads the `.zip`, checks GitHub's
  SHA-256 digest, and swaps the `.app` with a small shell script after quit.
- `hardenedRuntime` must stay off, or node-pty's native module fails to load.
- First launch of a downloaded build needs `xattr -cr /Applications/MrTerminal.app`.

The update check uses GitHub's unauthenticated API, so it finds nothing while
the repository is private.

## Verifying UI changes

There are no UI tests; drive the real app. On a Linux machine without a usable
display:

```sh
npm run build
MRTERMINAL_HOME=/tmp/mrt-home xvfb-run -a npx electron . --no-sandbox \
  --ozone-platform=x11 --remote-debugging-port=9333
```

then script it over the Chrome DevTools Protocol. `--ozone-platform=x11` is
required when a Wayland session exists; without it the window is never drawn
and rendering appears frozen.

- `MRTERMINAL_HOME` redirects the config directory away from `~/.mrterminal`.
- `MRTERMINAL_UPDATE_FEED` points the updater at another "latest release" URL.

macOS-specific behaviour (the .dmg, the update swap, traffic-light layout)
cannot be exercised on Linux; say so rather than assume it works.

## Style

TypeScript strict, no semicolons, single quotes, 2-space indent. Comments
explain why, not what. Keep dependencies few: prefer a small function over a
new package.
