---
name: mrt
description: Run and watch a project's long-running commands (dev servers, test watchers, workers, logs) in MrTerminal, the user's visual terminal workspace, with the `mrt` CLI. Use it to start or stop a server, run tests and read their output and exit code, check what is running, or type into a terminal the user is looking at, instead of running long-lived processes in your own shell.
---

# MrTerminal (`mrt`)

MrTerminal is a desktop app that keeps a project's terminals in one window:
the dev server, the tests, the worker, side by side. `mrt` drives it. Every
terminal you open or type into appears in the app, so the user can see
what you do and step in. Nothing runs hidden in the background.

Use it when:

- a command keeps running (a dev server, `--watch`, a queue worker, `docker compose up`, `tail -f`). Your own shell would block or lose it.
- the user asks you to start, restart or stop something "in MrTerminal" or "in my terminal".
- you need to see what a running process printed: `mrt read`.
- you want to run tests and get back only their output and exit code: `mrt run test --wait`.

For quick one-off commands whose output you need straight away (`ls`,
`git status`), use your own shell as usual.

Check that it is available with `mrt status`. If `mrt` isn't installed,
follow https://kthilagarajan.github.io/mrterminal/setup.md, or ask the user to
choose **Shell → Install 'mrt' Command…** in MrTerminal.

## Core loop

```sh
mrt status                         # app running? projects, terminals, what runs
mrt scripts                        # what this project can run (package.json, Makefile, ...)
mrt run dev                        # start the "dev" script in its own terminal
mrt wait dev --match 'ready|listening on' --timeout 60   # until the server is up
mrt read dev --lines 40            # look at its recent output
mrt run test --wait                # run tests; prints output, exits with their code
mrt stop dev                       # Ctrl-C
```

Add `--json` to any command when you will parse the output.

## Choosing the project and terminal

- **Project:** by default, the one whose folder contains your current
  directory. Override with `-p <name|id|folder>`. Add a folder with
  `mrt project add <folder>`, list them with `mrt projects`, and bring one on
  screen with `mrt project show <name>`. `mrt project remove <name>` takes it
  out of the sidebar but doesn't touch the files.
- **Terminal (`<terminal>`):** an id from `mrt ls`, a tab title (`dev`), or
  the command line (`"npm run dev"`). `self` is the terminal you are running
  in, when your own shell is inside MrTerminal (`$MRT_TERMINAL_ID` is set). If
  a name matches several terminals, mrt lists them; use the id.

## Commands

| Command | What it does |
|---|---|
| `mrt status` | Whether the app runs; each project with its terminals and their state |
| `mrt ls [-p P]` | Open terminals: id, state (`running`, `idle (last: exit 1)`), title, command |
| `mrt projects` | Projects in the sidebar |
| `mrt project add <folder> [--name N]` / `remove <p>` / `show <p>` | Manage projects |
| `mrt scripts` | Detected scripts (with the names `run` accepts) and custom commands |
| `mrt open [--cwd D] [--title T] [--split right\|below\|tab] [-- <command>]` | New terminal; a shell, or one running a command |
| `mrt run <script\|command> [--wait] [--timeout S] [--new] [--cwd D] [--title T]` | Run a script by name (`dev`, `web:dev`, a custom command's name) or any command line. Reuses the terminal already open for it, and re-runs it if it had stopped. `--new` opens another one |
| `mrt send <terminal> <text> [--no-enter] [--wait]` | Type a line into a terminal and press Enter. With `--wait`, return that command's output and exit code |
| `mrt keys <terminal> <key>...` | Press keys: `ctrl-c`, `ctrl-d`, `enter`, `tab`, `esc`, `up`, `down`, `left`, `right`, `pageup`... (text goes through `send`) |
| `mrt stop <terminal>` | Ctrl-C |
| `mrt restart <terminal>` | Start the terminal again and re-run its command |
| `mrt close <terminal>` | Close the tab; whatever runs in it stops |
| `mrt show <terminal>` | Bring it on screen for the user |
| `mrt rename <terminal> <title>` | Rename the tab |
| `mrt read <terminal>` | The screen, as the user sees it (best for TUIs and prompts) |
| `mrt read <terminal> --lines N` / `--all` | The last N lines / the whole scrollback |
| `mrt read <terminal> --command` | Only the output of the last command, plus its exit code (stderr says `exit N`) |
| `mrt wait <terminal> [--timeout S]` | Wait for the running command to finish; prints its output, exits with its code |
| `mrt wait <terminal> --match RE` | Wait for output matching a regular expression (case-insensitive) since the current command started |
| `mrt preset list` / `launch <name>` / `save <name>` / `delete <name>` | Presets: saved sets of terminals and their layout. `save` captures what is open now |
| `mrt command add <name> <command> [--cwd D]` / `remove <name>` | The project's own commands in the sidebar; `run <name>` then works |
| `mrt config path` / `show` / `schema` | The config file, its contents, its JSON Schema |
| `mrt skill show` / `install [--dir D]` | This file. `install` writes it to `~/.agents/skills/mrt` and links it for Claude Code |

Exit codes: `0` ok, `1` error, `2` bad usage, `3` MrTerminal is not running
(mrt starts it unless `--no-launch` is given), `124` timed out. With `--wait`,
mrt exits with the command's own exit code.

## Good habits

- **Reuse before you open.** `mrt run dev` finds the dev server's terminal if
  it is open. Check `mrt ls` before opening duplicates with `--new`.
- **Waits are bounded.** `--timeout` defaults to 60 seconds. On a timeout
  the command keeps running. Read it with `mrt read`, or wait again.
- **Don't wait on servers to finish.** They don't. Wait with `--match` for
  their ready line, then carry on.
- **Clean up what you started** when the task is done, unless the user wants
  it left running: `mrt stop` or `mrt close`. Leave the user's own terminals
  alone unless asked.
- **Interactive prompts:** `mrt read <t>` shows the question; answer with
  `mrt send <t> y` or `mrt keys <t> down enter`.
- Exit codes and `--command` output come from shell integration (zsh,
  bash 4.4+, fish). In other shells `--wait` still waits, but reports no exit
  code.

## Configuration

Everything is stored as JSON in `~/.mrterminal/config.json` (`mrt config
path`). That includes projects, open terminals and their layout, presets,
custom commands, script aliases and settings. The format is described by a
JSON Schema (`mrt config schema`, also linked from the file's `$schema`).

**While the app is running it owns that file** and rewrites it within a
second of any change, so edits made there are lost. Change things through
`mrt` (`project add`, `command add`, `preset save`, ...). Edit the JSON
directly only while MrTerminal is closed. It is read and tidied at the next
start, and any missing field gets its default.

A preset written by hand needs only terminals; a `null` layout tiles them:

```json
{ "id": "p1", "name": "Full stack", "layout": null,
  "terminals": [
    { "id": "1", "title": "web", "cwd": "/abs/path/web", "command": "npm run dev" },
    { "id": "2", "title": "api", "cwd": "/abs/path/api", "command": "make run" } ] }
```
