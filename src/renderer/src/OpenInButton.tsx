import { useEffect, useState } from 'react'
import type { EditorInfo } from '@shared/types'
import { below, openMenu, type MenuEntry } from './ContextMenu'
import { Icon } from './Icon'
import { patchSettings, useStore } from './store'

/**
 * "Open in Cursor ▾" in the top bar: opens the project folder in an editor.
 * The left part uses the editor picked last; the arrow lists every editor
 * installed. Hidden when none is found.
 */
export function OpenInButton({ path }: { path: string }) {
  const chosen = useStore((s) => s.config?.settings.editor ?? null)
  const [editors, setEditors] = useState<EditorInfo[]>([])

  // Look again whenever the window comes back: an editor may have just been installed.
  useEffect(() => {
    let live = true
    const refresh = (): void => {
      void window.api.editors.list().then((list) => live && setEditors(list))
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      live = false
      window.removeEventListener('focus', refresh)
    }
  }, [])

  if (editors.length === 0) return null
  const current = editors.find((e) => e.id === chosen) ?? editors[0]

  const open = async (editor: EditorInfo): Promise<void> => {
    if (editor.id !== chosen) patchSettings({ editor: editor.id })
    const result = await window.api.editors.open(editor.id, path)
    if (!result.ok) window.alert(`Could not open ${editor.name}: ${result.error}`)
  }

  const showMenu = (element: Element): void => {
    const items: MenuEntry[] = editors.map((editor) => ({
      label: editor.id === current.id ? `${editor.name}  ✓` : editor.name,
      tooltip: editor.id === current.id ? undefined : `Open in ${editor.name} and make it the default`,
      action: () => void open(editor)
    }))
    const folder = window.api.platform === 'darwin' ? 'Finder' : window.api.platform === 'win32' ? 'Explorer' : 'File Manager'
    items.push(null, { label: `Show in ${folder}`, action: () => window.api.reveal(path) })
    openMenu(below(element), items)
  }

  return (
    <div className="split-btn">
      <button className="btn" data-tooltip={`Open this project's folder in ${current.name}`} onClick={() => void open(current)}>
        <Icon name="code" /> {current.name}
      </button>
      <button
        className="btn split-btn-more"
        data-tooltip="Open in another editor"
        aria-label="Choose an editor"
        aria-haspopup="menu"
        onClick={(event) => showMenu(event.currentTarget)}
      >
        <Icon name="chevronDown" />
      </button>
    </div>
  )
}
