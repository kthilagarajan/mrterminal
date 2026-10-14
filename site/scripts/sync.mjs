// Copy what the site publishes from the app's repository, so the skill, the
// schema and the screenshots on the web are always the ones in the code.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = join(site, '..')
const copies = [
  ['skills/mrt/SKILL.md', 'public/skill.md'],
  ['schema/config.schema.json', 'public/config.schema.json'],
  ['assets/icon.svg', 'public/icon.svg'],
  ['docs/screenshots/workspace.png', 'public/screenshots/workspace.png'],
  ['docs/screenshots/preset.png', 'public/screenshots/preset.png'],
  ['docs/screenshots/themes.png', 'public/screenshots/themes.png']
]
for (const [from, to] of copies) {
  mkdirSync(dirname(join(site, to)), { recursive: true })
  copyFileSync(join(repo, from), join(site, to))
}

// Rendered inside /docs/agents/: without the frontmatter, and a level down so
// the page keeps a single h1.
const skill = readFileSync(join(repo, 'skills/mrt/SKILL.md'), 'utf8')
  .replace(/^---\n[\s\S]*?\n---\n/, '')
  .replace(/^(#+) /gm, '#$1 ')
mkdirSync(join(site, 'src/generated'), { recursive: true })
writeFileSync(join(site, 'src/generated/skill.md'), skill)
