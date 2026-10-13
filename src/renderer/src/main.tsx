import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import 'dockview/dist/styles/dockview.css'
import './styles.css'
import { App } from './App'
import { saveNow } from './store'
import { connectPtyEvents } from './terminals'

connectPtyEvents()
window.addEventListener('beforeunload', saveNow)
document.documentElement.dataset.platform = window.api.platform

createRoot(document.getElementById('root')!).render(<App />)
