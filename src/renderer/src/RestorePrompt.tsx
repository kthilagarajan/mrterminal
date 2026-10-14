import { useState } from 'react'
import type { Config, RestoreMode } from '@shared/types'

type Choice = Exclude<RestoreMode, 'ask'>

export function RestorePrompt({
  config,
  onChoose
}: {
  config: Config
  onChoose: (mode: Choice, remember: boolean) => void
}) {
  const [remember, setRemember] = useState(false)
  const sessions = config.projects.filter((p) => p.terminals.length > 0)

  return (
    <div className="backdrop backdrop-solid">
      <div className="dialog">
        <h2>Pick up where you left off?</h2>
        <p className="muted">These terminals were open when you last quit:</p>
        <ul className="restore-list">
          {sessions.map((project) => (
            <li key={project.id}>
              <strong>{project.name}</strong>
              <span className="muted">
                {project.terminals.map((t) => t.command ?? 'shell').join('  ·  ')}
              </span>
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button className="btn btn-primary" data-tooltip="Restore your terminals and layout, and run their saved commands" autoFocus onClick={() => onChoose('resume', remember)}>
            Resume and run commands
          </button>
          <button className="btn" onClick={() => onChoose('layout', remember)} data-tooltip="Reopen every terminal with its command typed but not started">
            Restore layout only
          </button>
          <button className="btn" data-tooltip="Open your projects with no terminals from the previous session" onClick={() => onChoose('fresh', remember)}>
            Start fresh
          </button>
        </div>
        <label className="check" data-tooltip="Use this choice on future launches; you can change it in Settings">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Always do this, don't ask again
          <span className="muted"> (change it later in Settings)</span>
        </label>
      </div>
    </div>
  )
}
