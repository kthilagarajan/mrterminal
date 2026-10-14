import { describe, expect, it } from 'vitest'
import { plainText } from './plainText'

describe('plainText', () => {
  it('drops colours, titles and command marks', () => {
    expect(plainText('\x1b[32mok\x1b[0m \x1b]0;title\x07done\x1b]133;D;0\x07\r\n')).toBe('ok done')
  })

  it('keeps the final state of a line redrawn with carriage returns', () => {
    expect(plainText('progress 10%\rprogress 100%\r\nnext')).toBe('progress 100%\nnext')
    expect(plainText('abcdef\rXY')).toBe('XYcdef')
  })

  it('applies erase-line and column moves, so spinners leave nothing behind', () => {
    expect(plainText('done\r\n⠙\r\x1b[K')).toBe('done')
    expect(plainText('50%\x1b[2K\x1b[1G100%')).toBe('100%')
    expect(plainText('abcdef\x1b[3G\x1b[K!')).toBe('ab!')
  })

  it('applies backspaces and trims blank edges', () => {
    expect(plainText('\r\n\r\nab\bc  \r\n\r\n')).toBe('ac')
  })

  it('erases a zsh partial-line marker that a newline already made pointless', () => {
    expect(plainText(`out\r\n\x1b[7m%\x1b[27m${' '.repeat(79)}\r \r`)).toBe('out')
  })
})
