<img src="assets/icon.svg" width="64" height="64" alt="">

# MrTerminal

A visual workspace for the terminals a project needs. Add a repository, and
every script it defines is one click away; arrange the running terminals with
drag and drop; quit, reopen, and it all comes back.

The terminals are your real login shell (`$SHELL`, so zsh on macOS) running in
a pty. MrTerminal types the command into it for you, so Ctrl-C drops you back
at a prompt with the command in history, exactly as in Terminal.app or iTerm.

## Install

Download the `.dmg` from the [Releases](../../releases) page (`arm64` for Apple
silicon, `x64` for Intel) and drag MrTerminal to Applications.

The app is not notarized by Apple yet, so macOS blocks the first launch. Clear
the download flag once and it opens normally:

```sh
xattr -cr /Applications/MrTerminal.app
```

## Run from source

```sh
npm install
npm run dev        # develop with hot reload
npm run dist       # build MrTerminal.dmg into dist/ (run on a Mac)
```

Requires Node 20+. On macOS `npm install` needs no compiler: the pty library
ships prebuilt binaries.

## How it works

**Projects** (left, top). Add a folder with `+` or ⌘O. Each project keeps its
own terminals and layout, and they keep running while you look at another one.
The green badge counts running processes.

**Scripts** (left, bottom). Read from the project and its sub-folders:

| File | Runs as |
| --- | --- |
| `package.json` scripts | `npm` / `pnpm` / `yarn` / `bun run <name>`, chosen from `packageManager` or the lockfile |
| `pyproject.toml` | entry points, poe, pdm, taskipy and hatch tasks, via `uv run` / `poetry run` when the project uses them |
| `manage.py`, `main.py`, `app.py`… | `python3 <file>` |
| `Makefile`, `justfile` | `make <target>`, `just <recipe>` |
| `Procfile` | the command itself |
| `compose.yaml` | `docker compose up` / `logs` / `down` |
| `Cargo.toml`, `go.mod`, `deno.json`, `composer.json` | the usual commands |

Click a script to run it. Click it again to jump to its terminal (or re-run it
if it stopped); ⌥-click starts a second copy.

**Presets** (top of the script list). Several terminals in one click. Open the
terminals you want together, arrange them, then press `+` next to Presets and
name it. Clicking the preset later opens all of them in the same arrangement
and runs their commands. If some are already open it leaves them alone, adds
the missing ones and re-runs any that stopped. Presets are saved per project;
hover a preset to rename it, replace it with what is open now, or delete it.

**Custom commands** (below the detected scripts). Anything that is not in a script
file: press `+`, type the command, and optionally give it a name and a folder
to run in (relative to the project, or absolute). They are saved per project,
run like any other script, and can be edited or deleted from the row.

**Terminals** (right). Drag a tab onto the edge of any pane to split that way,
or onto another tab bar to stack it as a tab. Each pane also has buttons for
new tab, split right, split down and maximize. Double-click a tab title to
rename it. The dot is green while something is running in that terminal.

| | macOS | Linux / Windows |
| --- | --- | --- |
| New terminal | ⌘T | Ctrl+Shift+T |
| Split right / down | ⌘D / ⇧⌘D | Ctrl+Shift+D / Ctrl+Shift+E |
| Restart terminal | ⇧⌘R | Ctrl+Shift+R |
| Clear | ⌘K | Ctrl+Shift+K |
| Close terminal | ⌘W | Ctrl+Shift+W |
| Toggle sidebar | ⌘B | Ctrl+B |

## Sessions

Projects, open terminals, layouts and settings live in
`~/.mrterminal/config.json`. On launch MrTerminal asks what to do with the
terminals from last time:

- **Resume and run commands**: same layout, every command started again.
- **Restore layout only**: same layout, each command typed at the prompt
  waiting for Enter.
- **Start fresh**.

Tick "always do this" to stop being asked; change it later in Settings (⌘,).

Processes do not survive quitting the app: resuming starts them again, and
scrollback from the previous run is not kept.

## Code map

```
src/main/      Electron main process
  pty.ts         shell processes (node-pty)
  scripts.ts     script detection, with tests in scripts.test.ts
  config.ts      ~/.mrterminal/config.json
src/preload/   the API exposed to the UI
src/renderer/  React UI
  dock.ts        split/tab layout (dockview)
  terminals.ts   terminal views (xterm.js)
```

`npm test` runs the script-detection tests; `npm run typecheck` checks types.
