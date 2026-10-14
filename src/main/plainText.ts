/**
 * Terminal output as the lines a person would read: colours and other escape
 * sequences removed, and the edits a program makes within a line (carriage
 * return, backspace, erase line, move to column) applied the way a terminal
 * applies them, so a spinner or progress bar ends up as its final state.
 * Movement between lines is not followed; for full-screen programs read the
 * terminal's screen instead.
 */
export function plainText(raw: string): string {
  const lines: string[] = []
  let cells: string[] = []
  let col = 0

  const endLine = (): void => {
    lines.push(Array.from(cells, (c) => c ?? ' ').join('').trimEnd())
    cells = []
    col = 0
  }

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '\x1b') {
      const next = raw[i + 1]
      if (next === '[') {
        const csi = /^\x1b\[([0-?]*)[ -/]*([@-~])/.exec(raw.slice(i, i + 64))
        if (!csi) break // cut off mid-sequence
        i += csi[0].length - 1
        const n = parseInt(csi[1], 10)
        if (csi[2] === 'K') {
          if (csi[1] === '2') cells = []
          else if (csi[1] === '1') cells.fill(' ', 0, col + 1)
          else cells.length = Math.min(cells.length, col)
        } else if (csi[2] === 'G') col = Math.max(0, (n || 1) - 1)
        else if (csi[2] === 'C') col += n || 1
        else if (csi[2] === 'D') col = Math.max(0, col - (n || 1))
      } else if (next === ']' || next === 'P' || next === '_' || next === '^') {
        // A string (title, mark, link) up to BEL or ESC \
        const end = raw.slice(i + 2).search(/\x07|\x1b\\/)
        if (end < 0) break
        i += 2 + end + (raw[i + 2 + end] === '\x07' ? 0 : 1)
      } else if (next !== undefined && '()*+'.includes(next)) i += 2
      else i += 1
    } else if (ch === '\n') endLine()
    else if (ch === '\r') col = 0
    else if (ch === '\b') col = Math.max(0, col - 1)
    else if (ch === '\t' || ch >= ' ') {
      cells[col] = ch
      col++
    }
  }
  endLine()

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  while (lines.length > 0 && lines[0] === '') lines.shift()
  return lines.join('\n')
}
