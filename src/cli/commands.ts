/**
 * Every `mrt` command, its usage and what it does. `--help` is printed from
 * this table, and a test checks that the agent skill mentions each command.
 */
export interface CommandHelp {
  name: string
  usage: string
  summary: string
}

export const COMMANDS: CommandHelp[] = [
  { name: 'status', usage: 'status', summary: 'Is the app running? Projects and their terminals' },
  { name: 'ls', usage: 'ls [--project P]', summary: 'Open terminals: id, state, title, command' },
  { name: 'projects', usage: 'projects', summary: 'Projects in the sidebar' },
  { name: 'project', usage: 'project add <folder> [--name N] | remove <project> | show <project>', summary: 'Add, remove or switch to a project' },
  { name: 'scripts', usage: 'scripts [--project P]', summary: 'What a project can run: detected scripts and custom commands' },
  { name: 'open', usage: 'open [--cwd D] [--title T] [--split right|below|tab] [-- <command>]', summary: 'Open a terminal, optionally running a command' },
  { name: 'run', usage: 'run <script|command> [--cwd D] [--title T] [--new] [--wait] [--timeout S]', summary: 'Run a script or command; reuses its terminal if open' },
  { name: 'send', usage: 'send <terminal> <text> [--no-enter] [--wait] [--timeout S]', summary: 'Type a line into a terminal (and press Enter)' },
  { name: 'keys', usage: 'keys <terminal> <key>...', summary: 'Press keys: ctrl-c, enter, up, tab, esc...' },
  { name: 'stop', usage: 'stop <terminal>', summary: 'Interrupt what is running (Ctrl-C)' },
  { name: 'restart', usage: 'restart <terminal>', summary: 'Start the terminal again and re-run its command' },
  { name: 'close', usage: 'close <terminal>', summary: 'Close a terminal (stops what runs in it)' },
  { name: 'show', usage: 'show <terminal>', summary: 'Bring a terminal on screen' },
  { name: 'rename', usage: 'rename <terminal> <title>', summary: 'Rename a terminal tab' },
  { name: 'read', usage: 'read <terminal> [--lines N | --all | --command]', summary: 'Print what a terminal shows; --command: the last command\'s output and exit code' },
  { name: 'wait', usage: 'wait <terminal> [--match RE] [--timeout S]', summary: 'Wait for the running command to finish, or for output matching RE' },
  { name: 'preset', usage: 'preset list | launch <name> | save <name> | delete <name>', summary: 'Saved sets of terminals and their layout' },
  { name: 'command', usage: 'command add <name> <command> [--cwd D] | remove <name>', summary: 'A project\'s own commands, shown in the sidebar' },
  { name: 'config', usage: 'config [path | show | schema]', summary: 'Where the configuration lives, its contents, its JSON Schema' },
  { name: 'skill', usage: 'skill [show | install [--dir D]]', summary: 'The agent skill: installs to ~/.agents/skills/mrt, linked for Claude Code' }
]

export const GLOBAL_HELP = `Options for every command:
  -p, --project P   project by name, id or folder (default: the one you are in)
  --json            machine-readable output
  --no-launch       fail instead of starting MrTerminal when it is not running
  -h, --help        this help;  -v, --version

<terminal> is an id, a tab title or a command line ("npm run dev"); "self" is
the terminal mrt runs in. Exit codes: 0 ok, 1 error, 2 usage, 3 app not
running, 124 timed out; with --wait, the exit code of the command.`

export function helpText(version: string): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length))
  return [
    `mrt ${version}: drive MrTerminal from the command line.`,
    '',
    'Usage: mrt <command> [options]',
    '',
    ...COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
    '',
    GLOBAL_HELP,
    '',
    'mrt help <command> shows its options.'
  ].join('\n')
}
