import { below, openMenu, type MenuEntry } from './ContextMenu'
import { getDock } from './dock'
import { Icon } from './Icon'
import { idleActiveTerminal, openSettings, runGlobalCommand } from './actions'
import { getState } from './store'

/**
 * "+ Terminal ▾" in the top bar. The button opens a shell; the arrow lists the
 * global commands (coding agents and the user's own), each run in a new
 * terminal or, from its "current" choice, in the terminal on screen.
 */
export function TerminalButton({ projectId }: { projectId: string }) {
  const showMenu = (element: Element): void => {
    const commands = (getState().config?.globalCommands ?? []).filter((c) => !c.hidden && c.command.trim())
    const current = idleActiveTerminal(projectId)
    const items: MenuEntry[] = commands.map((command) => ({
      label: command.name || command.command,
      tooltip: `Run ${command.command} in a new terminal`,
      action: () => runGlobalCommand(projectId, command, 'new'),
      aside: {
        label: 'current',
        tooltip: current ? 'Run it in the terminal on screen' : 'The terminal on screen is busy; open a new one instead',
        disabled: !current,
        action: () => runGlobalCommand(projectId, command, 'current')
      }
    }))
    if (items.length > 0) items.push(null)
    items.push({ label: 'Global commands…', tooltip: 'Add, edit or hide the commands in this menu', action: () => openSettings('commands') })
    openMenu(below(element), items, undefined, true)
  }

  return (
    <div className="split-btn">
      <button className="btn" data-tooltip="Open a new terminal in this project's folder" onClick={() => getDock(projectId)?.openShell('auto')}>
        <Icon name="plus" /> Terminal
      </button>
      <button
        className="btn split-btn-more"
        data-tooltip="Start an agent or another global command"
        aria-label="Start an agent or another global command"
        aria-haspopup="menu"
        onClick={(event) => showMenu(event.currentTarget)}
      >
        <Icon name="chevronDown" />
      </button>
    </div>
  )
}
