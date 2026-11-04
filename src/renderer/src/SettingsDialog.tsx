import { useEffect, useState } from 'react'
import { displayKeys, keysFor, SHORTCUT_GROUPS } from '@shared/shortcuts'
import { THEMES } from '@shared/themes'
import type { Config, GlobalCommand, RestoreMode, Settings } from '@shared/types'
import { applyAppearance } from './appearance'
import { Icon } from './Icon'
import { getState, patchConfig, patchSettings, setState, uid, useStore, type SettingsTab } from './store'

const TABS: [SettingsTab, string][] = [
  ['general', 'General'],
  ['appearance', 'Appearance'],
  ['commands', 'Global commands'],
  ['shortcuts', 'Shortcuts']
]

const RESTORE_OPTIONS: [RestoreMode, string][] = [
  ['ask', 'Ask every time'],
  ['resume', 'Reopen terminals and run their commands'],
  ['layout', 'Reopen terminals, leave commands typed but not started'],
  ['fresh', 'Start with no terminals']
]

/** Offered as suggestions; any font installed on the machine can be typed in. */
const FONT_SUGGESTIONS = [
  'Geist Mono',
  'SF Mono',
  'Menlo',
  'Monaco',
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Source Code Pro',
  'Hack',
  'IBM Plex Mono',
  'MesloLGS NF',
  'JetBrainsMono Nerd Font',
  'FiraCode Nerd Font',
  'Hack Nerd Font'
]

function setGlobalCommands(edit: (commands: GlobalCommand[]) => GlobalCommand[]): void {
  patchConfig({ globalCommands: edit(getState().config?.globalCommands ?? []) })
}

/**
 * The commands in the "+ Terminal ▾" menu. Each is a name and a command line;
 * the program it starts is looked up so a typo or a missing install shows.
 */
function GlobalCommands({ commands }: { commands: GlobalCommand[] }) {
  const [found, setFound] = useState<Record<string, string | null>>({})
  const lines = commands.map((c) => c.command)
  const key = lines.join('\n')

  useEffect(() => {
    let live = true
    const timer = window.setTimeout(() => {
      void window.api.programs.find(lines).then((paths) => {
        if (live) setFound(Object.fromEntries(lines.map((line, i) => [line, paths[i]])))
      })
    }, 250)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [key])

  const edit = (id: string, patch: Partial<GlobalCommand>): void =>
    setGlobalCommands((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  // Built-in agents that were removed come back; ones not found before but
  // installed since are pointed at their program and shown.
  const findAgents = async (): Promise<void> => {
    const detected = await window.api.programs.agents()
    const paths = await window.api.programs.find(getState().config?.globalCommands.map((c) => c.command) ?? [])
    setGlobalCommands((list) => {
      const next = list.map((c, i) => {
        const agent = detected.find((d) => d.id === c.id)
        return agent && !agent.hidden && !paths[i] ? { ...c, command: agent.command, hidden: undefined } : c
      })
      return [...next, ...detected.filter((d) => !list.some((c) => c.id === d.id))]
    })
  }

  return (
    <>
      <p className="muted small commands-intro">
        Start these from the arrow next to <b>+ Terminal</b> in any project. Each one opens a new terminal in the
        project's folder, or runs in the terminal on screen.
      </p>
      <div className="commands">
        {commands.map((c) => {
          const path = c.command.trim() ? found[c.command] : undefined
          return (
            <div key={c.id} className={c.hidden ? 'command-row command-hidden' : 'command-row'}>
              <input
                type="checkbox"
                className="command-show"
                checked={!c.hidden}
                data-tooltip={c.hidden ? 'Show it in the menu' : 'Hide it from the menu'}
                aria-label={`Show ${c.name} in the menu`}
                onChange={(e) => edit(c.id, { hidden: e.target.checked ? undefined : true })}
              />
              <input
                type="text"
                className="command-name"
                placeholder="Name"
                aria-label="Name"
                value={c.name}
                onChange={(e) => edit(c.id, { name: e.target.value })}
              />
              <div className="command-line">
                <input
                  type="text"
                  spellCheck={false}
                  placeholder="Program or path, and any arguments"
                  aria-label="Command"
                  value={c.command}
                  onChange={(e) => edit(c.id, { command: e.target.value })}
                />
                {path !== undefined && (
                  <small className={path ? 'command-path' : 'command-path command-missing'} data-tooltip={path ?? undefined}>
                    {path ? path.replace(window.api.home, '~') : 'Not found on this computer'}
                  </small>
                )}
              </div>
              <button
                className="icon-btn"
                data-tooltip="Remove this command"
                aria-label={`Remove ${c.name}`}
                onClick={() => setGlobalCommands((list) => list.filter((x) => x.id !== c.id))}
              >
                <Icon name="trash" />
              </button>
            </div>
          )
        })}
      </div>
      <div className="commands-actions">
        <button
          className="btn"
          data-tooltip="Add a command of your own, such as an agent with its flags"
          onClick={() => setGlobalCommands((list) => [...list, { id: uid(), name: '', command: '' }])}
        >
          <Icon name="plus" /> Add command
        </button>
        <button className="btn" data-tooltip="Look for Claude Code, Codex, Cursor, Antigravity and Grok again" onClick={() => void findAgents()}>
          Find installed agents
        </button>
      </div>
    </>
  )
}

export function SettingsDialog({ config }: { config: Config }) {
  const { settings, sidebarCompact: compact } = config
  const close = (): void => setState({ settingsOpen: false })
  const update = useStore((s) => s.update)
  const tab = useStore((s) => s.settingsTab)
  const setTab = (settingsTab: SettingsTab): void => setState({ settingsTab })
  const appearance = (patch: Partial<Settings>): void => {
    patchSettings(patch)
    applyAppearance({ ...settings, ...patch })
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog dialog-settings" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h2>Settings</h2>
        <div className="settings-tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'settings-tab settings-tab-active' : 'settings-tab'}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="settings-page" role="tabpanel">
          {tab === 'appearance' && (
            <>
              <div className="field">
                <span>Theme</span>
                <div className="themes">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      className={theme.id === settings.theme ? 'theme theme-active' : 'theme'}
                      data-tooltip={`Use the ${theme.name} theme`}
                      aria-pressed={theme.id === settings.theme}
                      style={{ background: theme.ui.bg, color: theme.ui.text, borderColor: theme.ui.border }}
                      onClick={() => appearance({ theme: theme.id })}
                    >
                      <span className="theme-swatches">
                        {[theme.ui.accent, theme.term.normal[2], theme.term.normal[4], theme.term.normal[3]].map((c) => (
                          <i key={c} style={{ background: c }} />
                        ))}
                      </span>
                      {theme.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-row">
                <label className="field field-grow">
                  <span>Terminal font</span>
                  <input
                    type="text"
                    list="font-suggestions"
                    spellCheck={false}
                    placeholder="Default (Geist Mono)"
                    data-tooltip="Use an installed font, or leave empty for Geist Mono"
                    value={settings.fontFamily ?? ''}
                    onChange={(e) => appearance({ fontFamily: e.target.value || null })}
                  />
                  <datalist id="font-suggestions">
                    {FONT_SUGGESTIONS.map((font) => (
                      <option key={font} value={font} />
                    ))}
                  </datalist>
                </label>
                <label className="field">
                  <span>Size</span>
                  <input
                    type="number"
                    data-tooltip="Terminal font size, from 9 to 24"
                    min={9}
                    max={24}
                    value={settings.fontSize}
                    onChange={(e) => appearance({ fontSize: Math.min(24, Math.max(9, Number(e.target.value) || 13)) })}
                  />
                </label>
              </div>
              <small className="muted">
                Type the name of any font installed on this computer. If it is not found, the default is used.
              </small>

              <div className="field">
                <span>Sidebar</span>
                <label className="check" data-tooltip="Show each project on one line: a colour square and its name">
                  <input type="checkbox" checked={compact} onChange={(e) => patchConfig({ sidebarCompact: e.target.checked })} />
                  Compact project list
                </label>
                <label className="check" data-tooltip="List the commands running in each project under its name">
                  <input type="checkbox" checked={settings.showRunning} onChange={(e) => patchSettings({ showRunning: e.target.checked })} />
                  Show what is running under each project
                </label>
              </div>
            </>
          )}

          {tab === 'general' && (
            <>
              <label className="field">
                <span>When MrTerminal starts</span>
                <select
                  data-tooltip="Choose how terminals and commands are restored when the app starts"
                  value={settings.restoreOnLaunch}
                  onChange={(e) => patchSettings({ restoreOnLaunch: e.target.value as RestoreMode })}
                >
                  {RESTORE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Shell</span>
                <input
                  type="text"
                  spellCheck={false}
                  placeholder="Your login shell ($SHELL)"
                  data-tooltip="Path to the shell for new terminals; leave empty to use your login shell"
                  value={settings.shell ?? ''}
                  onChange={(e) => patchSettings({ shell: e.target.value.trim() || null })}
                />
                <small className="muted">Applies to terminals opened from now on.</small>
              </label>

              <div className="field">
                <span>Updates</span>
                <div className="update-row">
                  <span className="muted">
                    Version {update?.current ?? ''}
                    {update?.status === 'checking' && ' · checking…'}
                    {update?.status === 'idle' && ' · up to date'}
                    {update?.status === 'available' && ` · ${update.version} is available`}
                    {update?.status === 'downloading' && ` · downloading ${update.version} (${update.progress ?? 0}%)`}
                    {update?.status === 'installing' && ' · restarting…'}
                    {update?.status === 'error' && ` · ${update.error}`}
                  </span>
                  {update?.status === 'available' ? (
                    <button className="btn btn-primary" data-tooltip={update.canInstall ? 'Install the update and restart MrTerminal' : 'Open the latest release download page'} onClick={() => window.api.update.install()}>
                      {update.canInstall ? 'Update and restart' : 'Open download page'}
                    </button>
                  ) : (
                    <button className="btn" data-tooltip="Check for a newer version of MrTerminal" disabled={update?.status !== 'idle' && update?.status !== 'error'} onClick={() => void window.api.update.check()}>
                      Check for updates
                    </button>
                  )}
                </div>
              </div>

              <p className="muted small">
                Projects, layouts and these settings are stored in <code>~/.mrterminal/config.json</code>.
              </p>
            </>
          )}

          {tab === 'commands' && <GlobalCommands commands={config.globalCommands} />}

          {tab === 'shortcuts' && (
            <div className="shortcuts">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.title} className="shortcut-group">
                  <div className="shortcut-title">{group.title}</div>
                  {group.items.map(([id, label]) => (
                    <div key={id} className="shortcut">
                      <span>{label}</span>
                      <kbd>{displayKeys(keysFor(id, window.api.platform), window.api.platform)}</kbd>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dialog-actions dialog-actions-end">
          <button className="btn btn-primary" data-tooltip="Close settings; your changes are saved automatically" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
