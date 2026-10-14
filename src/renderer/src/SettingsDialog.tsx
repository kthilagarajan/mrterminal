import { THEMES } from '@shared/themes'
import type { RestoreMode, Settings } from '@shared/types'
import { applyAppearance } from './appearance'
import { patchSettings, setState, useStore } from './store'

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

export function SettingsDialog({ settings }: { settings: Settings }) {
  const close = (): void => setState({ settingsOpen: false })
  const update = useStore((s) => s.update)
  const appearance = (patch: Partial<Settings>): void => {
    patchSettings(patch)
    applyAppearance({ ...settings, ...patch })
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h2>Settings</h2>

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
        <div className="dialog-actions dialog-actions-end">
          <button className="btn btn-primary" data-tooltip="Close settings; your changes are saved automatically" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
