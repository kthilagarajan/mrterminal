// node-pty's macOS prebuilds ship a `spawn-helper` binary that can lose its
// executable bit during `npm install`, which makes every spawn fail with
// "posix_spawnp failed". Restore it.
const fs = require('fs')
const path = require('path')

const prebuilds = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
if (fs.existsSync(prebuilds)) {
  for (const dir of fs.readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, dir, 'spawn-helper')
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755)
  }
}
