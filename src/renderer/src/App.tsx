import { useEffect, useRef } from 'react'
import { applyRestore, boot, handleMenu, pickProject } from './actions'
import { getDock, ProjectDock } from './dock'
import { Icon } from './Icon'
import { RestorePrompt } from './RestorePrompt'
import { SettingsDialog } from './SettingsDialog'
import { Sidebar } from './Sidebar'
import { patchConfig, refreshScripts, useStore } from './store'

function Workspace({ projectId, active }: { projectId: string; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dock = new ProjectDock(ref.current!, projectId)
    return () => dock.dispose()
  }, [projectId])

  useEffect(() => {
    if (active) getDock(projectId)?.focus()
  }, [projectId, active])

  // Inactive projects stay laid out (just invisible) so their terminals keep
  // a real size and keep streaming output in the background.
  return <div ref={ref} className={active ? 'workspace' : 'workspace workspace-hidden'} />
}

function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-title">Add a project to get started</div>
      <p>
        Point MrTerminal at a repository. It reads the scripts from <code>package.json</code>,{' '}
        <code>pyproject.toml</code>, <code>Makefile</code> and friends, so every command is one click away.
      </p>
      <button className="btn btn-primary" onClick={() => void pickProject()}>
        Add Project…
      </button>
    </div>
  )
}

export function App() {
  const config = useStore((s) => s.config)
  const ready = useStore((s) => s.ready)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const activeId = config?.activeProjectId ?? null

  useEffect(() => {
    void boot()
    return window.api.onMenu(handleMenu)
  }, [])

  // Scripts change on disk (new branch, edited package.json); re-read them
  // when the project is shown and whenever the window regains focus.
  useEffect(() => {
    if (!ready || !activeId) return
    const refresh = (): void => void refreshScripts(activeId)
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [ready, activeId])

  if (!config) return null
  if (!ready) return <RestorePrompt config={config} onChoose={applyRestore} />

  const active = config.projects.find((p) => p.id === activeId)

  return (
    <div className="app">
      {!config.sidebarHidden && <Sidebar config={config} />}
      <main className="main">
        <header className={config.sidebarHidden ? 'topbar topbar-inset' : 'topbar'}>
          <button
            className="icon-btn"
            title="Toggle sidebar"
            onClick={() => patchConfig({ sidebarHidden: !config.sidebarHidden })}
          >
            <Icon name="sidebar" />
          </button>
          {active && (
            <>
              <span className="topbar-name">{active.name}</span>
              <button className="topbar-path" title="Open folder" onClick={() => window.api.reveal(active.path)}>
                {active.path.replace(window.api.home, '~')}
              </button>
              <span className="spacer" />
              <button className="btn" onClick={() => getDock(active.id)?.openShell('auto')}>
                <Icon name="plus" /> Terminal
              </button>
            </>
          )}
        </header>
        <div className="workspaces">
          {config.projects.map((p) => (
            <Workspace key={p.id} projectId={p.id} active={p.id === activeId} />
          ))}
          {config.projects.length === 0 && <Welcome />}
        </div>
      </main>
      {settingsOpen && <SettingsDialog settings={config.settings} />}
    </div>
  )
}
