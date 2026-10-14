import { Icon } from './Icon'
import { useStore } from './store'

/** Appears in the top bar when a newer version has been published. */
export function UpdateButton() {
  const update = useStore((s) => s.update)
  if (!update?.version) return null

  switch (update.status) {
    case 'available':
      return (
        <button
          className="btn btn-update"
          data-tooltip={
            update.canInstall
              ? `You have ${update.current}. Click to download ${update.version} and restart.\nYour terminals reopen afterwards.`
              : `You have ${update.current}. Click to open the download page.`
          }
          onClick={() => window.api.update.install()}
        >
          <Icon name="download" /> Update to {update.version}
        </button>
      )
    case 'downloading':
      return (
        <button className="btn btn-update" data-tooltip={`Downloading MrTerminal ${update.version}`} disabled>
          Downloading {update.progress ?? 0}%
        </button>
      )
    case 'installing':
      return (
        <button className="btn btn-update" data-tooltip="Installing the update and restarting MrTerminal" disabled>
          Restarting…
        </button>
      )
    case 'error':
      return (
        <button className="btn btn-update-failed" data-tooltip={`${update.error}\nClick to try again.`} onClick={() => window.api.update.install()}>
          Update failed · Retry
        </button>
      )
    default:
      return null
  }
}
