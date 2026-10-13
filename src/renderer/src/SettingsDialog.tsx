import type { RestoreMode, Settings } from '@shared/types'
import { patchSettings, setState } from './store'
import { setFontSize } from './terminals'

const RESTORE_OPTIONS: [RestoreMode, string][] = [
  ['ask', 'Ask every time'],
  ['resume', 'Reopen terminals and run their commands'],
  ['layout', 'Reopen terminals, leave commands typed but not started'],
  ['fresh', 'Start with no terminals']
]

export function SettingsDialog({ settings }: { settings: Settings }) {
  const close = (): void => setState({ settingsOpen: false })

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h2>Settings</h2>

        <label className="field">
          <span>When MrTerminal starts</span>
          <select
            autoFocus
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
          <span>Font size</span>
          <input
            type="number"
            min={9}
            max={24}
            value={settings.fontSize}
            onChange={(e) => {
              const size = Math.min(24, Math.max(9, Number(e.target.value) || 13))
              patchSettings({ fontSize: size })
              setFontSize(size)
            }}
          />
        </label>

        <label className="field">
          <span>Shell</span>
          <input
            type="text"
            spellCheck={false}
            placeholder="Your login shell ($SHELL)"
            value={settings.shell ?? ''}
            onChange={(e) => patchSettings({ shell: e.target.value.trim() || null })}
          />
          <small className="muted">Applies to terminals opened from now on.</small>
        </label>

        <p className="muted small">
          Projects, layouts and these settings are stored in <code>~/.mrterminal/config.json</code>.
        </p>
        <div className="dialog-actions dialog-actions-end">
          <button className="btn btn-primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
