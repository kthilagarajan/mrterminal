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

### Updates

MrTerminal checks this repository's GitHub releases when it starts and every
few hours. When a newer version exists an **Update to x.y.z** button appears in
the top bar; clicking it downloads the update, verifies its checksum, replaces
the app and restarts it, and your terminals reopen. Settings shows the running
version and has a "Check for updates" button.

The check uses GitHub's public API, so it only finds releases while the
repository is public.

To publish a version: bump `version` in `package.json`, commit, then
`git tag v<version> && git push --tags`.

## Run from source

```sh
npm install
npm run dev        # develop with hot reload
npm run dist       # build MrTerminal.dmg into dist/ (run on a Mac)
```

Requires Node 20+. On macOS `npm install` needs no compiler: the pty library
ships prebuilt binaries.

## How it works

**The sidebar is a list of project cards.** Add a folder with `+` or ⌘O. Click
a project to show its terminals on the right; click the one already shown to
unfold or fold it. Folded, a card lists only what is running in it right now.
Unfolded, it also lists everything it can run. Every heading inside a card
(Running, Presets, each script file, Custom commands) folds on a click. Each
project gets its own colour, used for its icon and its outline. Each project keeps its own
terminals and layout, and they keep running while you look at another one.

Hovering a project shows its buttons: stop everything running in it, re-read
its scripts from disk, and a menu to move it up or down, open its folder or
remove it. Drag a project to reorder; a blue line shows where it will land.

**Running** means a command is executing in that terminal right now. A
terminal waiting at its prompt is not running, whatever opened it. The count
beside a project, the green dots and the *Running* list at the top of its card
(each entry with its own stop button, the same as Ctrl-C) all follow that. MrTerminal learns it from
the shell itself (zsh, bash 4.4+ and fish 4 report when a command starts and
ends), so it also covers commands you type by hand.

**Scripts.** Read from the project and its sub-folders:

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
if it stopped); ⌥-click starts a second copy. Scripts are re-read whenever the
window gets focus, or with the project's refresh button.

To give a script a friendlier name (say `UAT server` instead of `dev:uat`),
hover it and press the pencil, or double-click the title of its tab. The name
shows in both places and is remembered per project; the command itself is
untouched. Clear the name to go back to the original. If the script is later
renamed or removed in the project, the old name is simply dropped.

**Presets.** Several terminals in one click. Open the terminals you want
together, arrange them, then press `+` next to Presets. The dialog shows a
miniature of the window with numbered panes and the command behind each
number; remove the ones you do not want and save. Clicking the preset puts
those terminals in that arrangement: ones already open are kept and moved
into place, stopped ones are re-run, missing ones are started. The pencil on a
preset reopens the dialog to rename it, drop terminals, replace it with what
is open now, or delete it.

**Custom commands.** Anything that is not in a script file: press `+`, type
the command, and optionally give it a name and a folder to run in (relative to
the project, or absolute). They are saved per project, run like any other
script, and can be edited or deleted from the row.

**Terminals** (right). Drag a tab onto the edge of any pane to split that way,
or onto another tab bar to stack it as a tab. Each pane also has buttons for
new tab, split right, split down and maximize. Double-click a tab title to
rename it. A plain terminal is named after the folder it opens in.

Closed something by mistake? ⇧⌘T (or the arrow in the top bar) reopens the
last closed tab where it was and runs its command again; it also brings back
a project you just removed, with its presets and commands.

| | macOS | Linux / Windows |
| --- | --- | --- |
| New terminal | ⌘T | Ctrl+Shift+T |
| Split right / down | ⌘D / ⇧⌘D | Ctrl+Shift+D / Ctrl+Shift+E |
| Restart terminal | ⇧⌘R | Ctrl+Shift+R |
| Clear | ⌘K | Ctrl+Shift+K |
| Close terminal | ⌘W | Ctrl+Shift+W |
| Reopen closed tab or project | ⇧⌘T | Ctrl+Shift+Z |
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

## Appearance

Settings (⌘,) has six themes (Midnight, Dracula, Nord, Solarized Dark,
Daylight, Solarized Light) that recolour the app and the terminals together,
and a terminal font field. The app uses Geist for its interface and Geist Mono
in terminals by default (both bundled); to change the terminal font, type the
name of any font installed on the machine
(for example a Nerd Font for prompt icons) and pick a size.

A project whose folder no longer exists is dropped from the list at startup.

Processes do not survive quitting the app: resuming starts them again, and
scrollback from the previous run is not kept.

## Code map

```
src/main/      Electron main process
  pty.ts         shell processes (node-pty)
  scripts.ts     script detection, with tests in scripts.test.ts
  config.ts      ~/.mrterminal/config.json
  updater.ts     over-the-air updates from GitHub releases
src/shared/    types and themes used by both sides
src/preload/   the API exposed to the UI
src/renderer/  React UI
  dock.ts        split/tab layout (dockview)
  terminals.ts   terminal views (xterm.js)
```

`npm test` runs the script-detection tests; `npm run typecheck` checks types.
