import type { GlobalCommand } from '@shared/types'
import { below, openMenu, type MenuEntry } from './ContextMenu'
import { getDock } from './dock'
import { Icon } from './Icon'
import { idleActiveTerminal, openSettings, runGlobalCommand } from './actions'
import { patchSettings, useStore } from './store'

const NONE: GlobalCommand[] = []

/**
 * "+ Terminal ▾" in the top bar. The arrow lists a plain shell and the global
 * commands (coding agents and the user's own), each run in a new terminal or,
 * from its "current" choice, in the terminal on screen. Whatever was picked
 * last becomes the button, until the user picks again or resets it.
 */
export function TerminalButton({ projectId }: { projectId: string }) {
  const chosenId = useStore((s) => s.config?.settings.terminalCommand ?? null)
  const commands = useStore((s) => s.config?.globalCommands ?? NONE)
  const usable = commands.filter((c) => !c.hidden && c.command.trim())
  // A command since deleted or hidden falls back to a plain shell.
  const chosen = usable.find((c) => c.id === chosenId) ?? null

  const remember = (id: string | null): void => {
    if (id !== chosenId) patchSettings({ terminalCommand: id })
  }
  const openShell = (): void => {
    remember(null)
    getDock(projectId)?.openShell('auto')
  }
  const run = (command: GlobalCommand, where: 'new' | 'current'): void => {
    remember(command.id)
    runGlobalCommand(projectId, command, where)
  }

  const showMenu = (element: Element): void => {
    const current = idleActiveTerminal(projectId)
    const items: MenuEntry[] = [
      { label: chosen ? 'Terminal' : 'Terminal ✓', tooltip: "Open a plain shell in this project's folder", action: openShell }
    ]
    for (const command of usable) {
      const name = command.name || command.command
      items.push({
        label: command.id === chosen?.id ? `${name} ✓` : name,
        tooltip: `Run ${command.command} in a new terminal`,
        action: () => run(command, 'new'),
        aside: {
          label: 'current',
          tooltip: current ? 'Run it in the terminal on screen' : 'The terminal on screen is busy; open a new one instead',
          disabled: !current,
          action: () => run(command, 'current')
        }
      })
    }
    items.push(null)
    if (chosenId !== null) {
      items.push({ label: 'Reset to Terminal', tooltip: 'Make the button open a plain shell again', action: () => remember(null) })
    }
    items.push({ label: 'Global commands…', tooltip: 'Add, edit or hide the commands in this menu', action: () => openSettings('commands') })
    openMenu(below(element), items, undefined, true)
  }

  return (
    <div className="split-btn">
      {chosen ? (
        <button className="btn" data-tooltip={`Run ${chosen.command} in a new terminal`} onClick={() => run(chosen, 'new')}>
          <Icon name="terminal" /> {chosen.name || chosen.command}
        </button>
      ) : (
        <button className="btn" data-tooltip="Open a new terminal in this project's folder" onClick={openShell}>
          <Icon name="plus" /> Terminal
        </button>
      )}
      <button
        className="btn split-btn-more"
        data-tooltip="Open a terminal, an agent or another global command"
        aria-label="Choose what the terminal button starts"
        aria-haspopup="menu"
        onClick={(event) => showMenu(event.currentTarget)}
      >
        <Icon name="chevronDown" />
      </button>
    </div>
  )
}
