import { describe, expect, it } from 'vitest'
import { AGENT_RULES, withRules } from './rules'

describe('withRules', () => {
  it('writes the block into an empty file', () => {
    expect(withRules('')).toBe(`${AGENT_RULES}\n`)
  })

  it("appends after the user's own text", () => {
    expect(withRules('# Mine\nbe nice')).toBe(`# Mine\nbe nice\n\n${AGENT_RULES}\n`)
  })

  it('replaces an earlier block in place and is idempotent', () => {
    const old = AGENT_RULES.replace('Reuse the project', 'OLD TEXT')
    const file = `# Mine\n\n${old}\n\n# After\n`
    const once = withRules(file)
    expect(once).toBe(`# Mine\n\n${AGENT_RULES}\n\n# After\n`)
    expect(withRules(once)).toBe(once)
  })
})
