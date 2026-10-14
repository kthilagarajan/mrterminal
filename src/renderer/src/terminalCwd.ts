/** OSC 7 reports the shell's directory as a file URI. Ignore malformed reports. */
export function cwdFromOsc7(value: string, platform: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:' || !url.pathname.startsWith('/')) return null
    const path = decodeURIComponent(url.pathname)
    if (/[\x00-\x1f\x7f]/.test(path)) return null
    if (platform === 'win32') {
      if (url.hostname && url.hostname !== 'localhost') return `//${url.hostname}${path}`
      return path.replace(/^\/([a-z]:\/)/i, '$1')
    }
    return path
  } catch {
    return null
  }
}
