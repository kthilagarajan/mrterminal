import { createRoot } from 'react-dom/client'
// Geist ships with the app (OFL licence), so it looks the same everywhere.
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@xterm/xterm/css/xterm.css'
import 'dockview/dist/styles/dockview.css'
import './styles.css'
import { App } from './App'
import { saveNow } from './store'
import { connectPtyEvents, refitAll } from './terminals'

connectPtyEvents()
// A terminal measures its cells from the font; once Geist Mono has loaded,
// measure again in case one was opened before it arrived.
void document.fonts.load('13px "Geist Mono Variable"').then(refitAll)
window.addEventListener('beforeunload', saveNow)
document.documentElement.dataset.platform = window.api.platform

createRoot(document.getElementById('root')!).render(<App />)
