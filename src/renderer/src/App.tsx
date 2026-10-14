import { useEffect, useRef } from 'react'
import { displayKeys, keysFor } from '@shared/shortcuts'
import { applyRestore, boot, handleKey, handleMenu, pickProject, reopenClosed } from './actions'
import { ContextMenu } from './ContextMenu'
import { getDock, ProjectDock } from './dock'
import { Icon } from './Icon'
import { RestorePrompt } from './RestorePrompt'
import { SettingsDialog } from './SettingsDialog'
import { Sidebar } from './Sidebar'
import { UpdateButton } from './UpdateButton'
import { getState, patchConfig, refreshScripts, setState, useStore } from './store'

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
      <button className="btn btn-primary" data-tooltip="Choose a project folder to add to your workspace" onClick={() => void pickProject()}>
        Add Project…
      </button>
    </div>
  )
}

export function App() {
  const config = useStore((s) => s.config)
  const ready = useStore((s) => s.ready)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const closedCount = useStore((s) => s.closedCount)
  const quitArmed = useStore((s) => s.quitArmed)
  const opened = useStore((s) => s.opened)
  const activeId = config?.activeProjectId ?? null

  // A project's terminals start when it is first shown, not at launch, and
  // keep running from then on.
  useEffect(() => {
    if (!ready || !activeId || getState().opened.includes(activeId)) return
    setState({ opened: [...getState().opened, activeId] })
  }, [ready, activeId])

  useEffect(() => {
    void boot()
    // Capture phase: a focused terminal would otherwise take the key.
    window.addEventListener('keydown', handleKey, true)
    const offMenu = window.api.onMenu(handleMenu)
    return () => {
      window.removeEventListener('keydown', handleKey, true)
      offMenu()
    }
  }, [])

  // Scripts change on disk (new branch, edited package.json); re-read them
  // for every project at start and whenever the window regains focus.
  const projectIds = config?.projects.map((p) => p.id).join(',') ?? ''
  useEffect(() => {
    if (!ready) return
    const refresh = (): void => {
      for (const id of projectIds.split(',').filter(Boolean)) void refreshScripts(id)
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [ready, projectIds])

  const quitBanner = quitArmed && (
    <div className="quit-banner" role="status">
      Press <kbd>{displayKeys(keysFor('quit', window.api.platform), window.api.platform)}</kbd> again to quit
    </div>
  )

  if (!config) return null
  if (!ready) return (
    <>
      <RestorePrompt config={config} onChoose={applyRestore} />
      {quitBanner}
    </>
  )

  const active = config.projects.find((p) => p.id === activeId)

  return (
    <div className="app">
      {!config.sidebarHidden && <Sidebar config={config} />}
      <main className="main">
        <header className={config.sidebarHidden ? 'topbar topbar-inset' : 'topbar'}>
          <button
            className="icon-btn"
            data-tooltip="Toggle sidebar"
            aria-label="Toggle sidebar"
            onClick={() => patchConfig({ sidebarHidden: !config.sidebarHidden })}
          >
            <Icon name="sidebar" />
          </button>
          {closedCount > 0 && (
            <button
              className="icon-btn"
              data-tooltip={`Reopen the tab or project you just closed (${window.api.platform === 'darwin' ? '⇧⌘T' : 'Ctrl+Shift+Z'})`}
              aria-label="Reopen the last closed terminal or project"
              onClick={reopenClosed}
            >
              <Icon name="undo" />
            </button>
          )}
          {active && (
            <>
              <span className="topbar-name">{active.name}</span>
              <button className="topbar-path" data-tooltip="Open folder" onClick={() => window.api.reveal(active.path)}>
                {active.path.replace(window.api.home, '~')}
              </button>
              <span className="spacer" />
              <UpdateButton />
              <button className="btn" data-tooltip="Open a new terminal in this project's folder" onClick={() => getDock(active.id)?.openShell('auto')}>
                <Icon name="plus" /> Terminal
              </button>
            </>
          )}
        </header>
        <div className="workspaces">
          {config.projects
            .filter((p) => p.id === activeId || opened.includes(p.id))
            .map((p) => (
              <Workspace key={p.id} projectId={p.id} active={p.id === activeId} />
            ))}
          {config.projects.length === 0 && <Welcome />}
        </div>
      </main>
      {settingsOpen && <SettingsDialog settings={config.settings} compact={config.sidebarCompact} />}
      <ContextMenu />
      {quitBanner}
    </div>
  )
}
