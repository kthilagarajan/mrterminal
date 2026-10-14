import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, defaultConfig } from '@shared/types'
import { COMMANDS } from './commands'

const root = join(__dirname, '..', '..')
const skill = readFileSync(join(root, 'skills', 'mrt', 'SKILL.md'), 'utf8')
const schema = JSON.parse(readFileSync(join(root, 'schema', 'config.schema.json'), 'utf8'))

describe('the agent skill', () => {
  it('documents every mrt command', () => {
    const missing = COMMANDS.filter((c) => !skill.includes(`mrt ${c.name}`)).map((c) => c.name)
    expect(missing).toEqual([])
  })

  it('has the frontmatter agents look for', () => {
    expect(skill).toMatch(/^---\nname: mrt\ndescription: .+\n---\n/)
  })
})

describe('the config schema', () => {
  it('describes every field of the config and its settings', () => {
    const config = { ...defaultConfig(), window: { width: 1, height: 1 } }
    expect(Object.keys(config).filter((k) => !(k in schema.properties))).toEqual([])
    expect(Object.keys(DEFAULT_SETTINGS).filter((k) => !(k in schema.$defs.Settings.properties))).toEqual([])
  })
})
