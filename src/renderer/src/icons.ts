const svg = (body: string, size = 14): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const icons = {
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  restart: svg('<path d="M13 8a5 5 0 1 1-1.5-3.55"/><path d="M13 2.5v3h-3"/>'),
  splitRight: svg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M8 3v10"/>'),
  splitDown: svg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 8h12"/>'),
  maximize: svg('<path d="M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10"/>'),
  play: svg('<path d="M5.6 4.3v7.4L11.4 8z" fill="currentColor" stroke-width="1.7"/>'),
  refresh: svg('<path d="M13 8a5 5 0 1 1-1.5-3.55"/><path d="M13 2.5v3h-3"/>'),
  folder: svg('<path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>'),
  gear: svg(
    '<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>'
  ),
  edit: svg('<path d="M10.5 3l2.5 2.5L6 12.5l-3 .5.5-3z"/>'),
  download: svg('<path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"/>'),
  stop: svg('<rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.7" fill="currentColor" stroke="none"/>'),
  more: svg('<circle cx="3.5" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor"/>'),
  undo: svg('<path d="M5.5 3L2.5 6l3 3"/><path d="M2.5 6h6.5a4 4 0 0 1 0 8H6"/>'),
  chevron: svg('<path d="M6 4l4 4-4 4"/>', 12),
  compact: svg('<path d="M3 4.5h10M3 8h10M3 11.5h10"/>'),
  sidebar: svg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 3v10"/>'),
  terminal: svg('<path d="M3 5l3 3-3 3M8 11h5"/>')
}

export type IconName = keyof typeof icons
