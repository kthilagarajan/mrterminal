import type { APIRoute } from 'astro'

/**
 * /setup.md: what a coding agent reads when the user pastes the prompt from
 * the home page. Generated so its links follow the site's address.
 */
export const GET: APIRoute = ({ site }) => {
  const home = new URL(import.meta.env.BASE_URL, site).href
  return new Response(setup(home), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}

const setup = (home: string): string => `# Set up MrTerminal

You are a coding agent, and the user wants you to work with MrTerminal: a macOS
app that keeps their project's terminals (dev servers, tests, workers) in one
window. You drive it with its \`mrt\` command, and the user watches every
terminal you open or type into. Nothing runs hidden.

Follow these steps in order. Skip any step that is already done. **Ask the user
before you install an app or use \`sudo\`.** At the end, tell them what you did.

## 1. Is \`mrt\` already available?

\`\`\`sh
command -v mrt && mrt --version
\`\`\`

If this prints a version, go to step 4.

## 2. Install the MrTerminal app (macOS)

\`\`\`sh
ls -d /Applications/MrTerminal.app
\`\`\`

If it is missing, ask the user, then download the latest release for this Mac:

\`\`\`sh
arch=$(uname -m); [ "$arch" = x86_64 ] && arch=x64
url=$(curl -fsSL https://api.github.com/repos/kthilagarajan/mrterminal/releases/latest \\
  | grep -o "https://[^\\"]*/MrTerminal-[^\\"]*-$arch\\.zip" | head -1)
curl -fL "$url" -o /tmp/MrTerminal.zip
ditto -x -k /tmp/MrTerminal.zip /Applications
xattr -cr /Applications/MrTerminal.app   # not notarized by Apple yet
\`\`\`

The user can also download it themselves from
https://github.com/kthilagarajan/mrterminal/releases/latest. MrTerminal is
macOS-only for now. On another system, tell the user, and stop.

## 3. Put \`mrt\` on the PATH

\`mrt\` ships inside the app and runs on the app's own runtime, so nothing else
(Node, Bun) is needed. Link it:

\`\`\`sh
mkdir -p ~/.local/bin
ln -sf /Applications/MrTerminal.app/Contents/Resources/bin/mrt ~/.local/bin/mrt
\`\`\`

If \`~/.local/bin\` is not on the PATH, link \`/usr/local/bin/mrt\` instead (ask
the user, as it may need \`sudo\`). The user can also choose **Shell → Install
'mrt' Command…** in the app. If \`Contents/Resources/bin/mrt\` does not exist, the
installed app is older than \`mrt\`: update it (step 2, or the app's own update
button).

## 4. Install the skill

\`\`\`sh
mrt skill install
\`\`\`

This writes the skill to \`~/.agents/skills/mrt/SKILL.md\`, the folder agents
share. For Claude Code it also links \`~/.claude/skills/mrt\` to that folder.
To keep the skill with one repository instead, run it there:
\`mrt skill install --dir .agents/skills/mrt\`.

If you read your skills or rules from somewhere else, put the output of
\`mrt skill show\` there. It is also at ${home}skill.md.

## 5. Check it works

\`\`\`sh
mrt status
\`\`\`

This starts MrTerminal if it isn't running and lists the projects and terminals.
To add the current repository: \`mrt project add .\`

Now read \`~/.agents/skills/mrt/SKILL.md\` and use \`mrt\` from here on. Use it
whenever you run a long-lived command (a dev server, a watcher, a worker), or
need to see or wait for a terminal's output.

Documentation: ${home}docs/agents/
`
