export interface Theme {
  id: string
  name: string
  dark: boolean
  /** Colours of the app itself; they become the `--name` CSS variables. */
  ui: {
    bg: string
    panel: string
    panel2: string
    hover: string
    border: string
    text: string
    muted: string
    faint: string
    accent: string
    green: string
    red: string
  }
  /** Terminal colours; background and foreground come from `ui`. */
  term: {
    selection: string
    /** black, red, green, yellow, blue, magenta, cyan, white */
    normal: [string, string, string, string, string, string, string, string]
    bright: [string, string, string, string, string, string, string, string]
  }
}

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    dark: true,
    ui: {
      bg: '#0d0e12',
      panel: '#13141a',
      panel2: '#191b23',
      hover: '#20232d',
      border: '#23262f',
      text: '#d7dae0',
      muted: '#7d8494',
      faint: '#565c6b',
      accent: '#db2777',
      green: '#4ade80',
      red: '#f87171'
    },
    term: {
      selection: '#3b4261',
      normal: ['#1c1e26', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'],
      bright: ['#565f89', '#ff899d', '#b9f27c', '#ffc777', '#8db0ff', '#c7a9ff', '#a4daff', '#ffffff']
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    dark: true,
    ui: {
      bg: '#282a36',
      panel: '#21222c',
      panel2: '#2d2f3d',
      hover: '#343746',
      border: '#3a3c4e',
      text: '#f8f8f2',
      muted: '#9ea2c0',
      faint: '#6272a4',
      accent: '#bd93f9',
      green: '#50fa7b',
      red: '#ff5555'
    },
    term: {
      selection: '#44475a',
      normal: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2'],
      bright: ['#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    dark: true,
    ui: {
      bg: '#2e3440',
      panel: '#272c36',
      panel2: '#353c4a',
      hover: '#3b4252',
      border: '#434c5e',
      text: '#d8dee9',
      muted: '#9aa5b8',
      faint: '#6b7890',
      accent: '#88c0d0',
      green: '#a3be8c',
      red: '#bf616a'
    },
    term: {
      selection: '#434c5e',
      normal: ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0'],
      bright: ['#4c566a', '#d06f79', '#b1cc9a', '#f0d399', '#8fb0d0', '#c39dbc', '#8fbcbb', '#eceff4']
    }
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    dark: true,
    ui: {
      bg: '#002b36',
      panel: '#00252e',
      panel2: '#073642',
      hover: '#0a3f4c',
      border: '#0f4654',
      text: '#a7b6b6',
      muted: '#7b8f93',
      faint: '#586e75',
      accent: '#268bd2',
      green: '#859900',
      red: '#dc322f'
    },
    term: {
      selection: '#0f4654',
      normal: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'],
      bright: ['#657b83', '#e35d5b', '#a3b825', '#d1a41a', '#4ba3e3', '#e0559b', '#45bdb3', '#fdf6e3']
    }
  },
  {
    id: 'daylight',
    name: 'Daylight',
    dark: false,
    ui: {
      bg: '#ffffff',
      panel: '#f5f6f8',
      panel2: '#eceef2',
      hover: '#e6e8ee',
      border: '#dcdfe6',
      text: '#1f2430',
      muted: '#5f6878',
      faint: '#9aa1ae',
      accent: '#db2777',
      green: '#16a34a',
      red: '#dc2626'
    },
    term: {
      selection: '#b6d5fb',
      normal: ['#24292f', '#cf222e', '#116329', '#7d4e00', '#0969da', '#8250df', '#1b7c83', '#6e7781'],
      bright: ['#57606a', '#a40e26', '#1a7f37', '#9a6700', '#218bff', '#a475f9', '#3192aa', '#8c959f']
    }
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    dark: false,
    ui: {
      bg: '#fdf6e3',
      panel: '#f5eed9',
      panel2: '#eee8d5',
      hover: '#e8e1cc',
      border: '#e0d9c3',
      text: '#4a5c63',
      muted: '#74858a',
      faint: '#a0aba9',
      accent: '#268bd2',
      green: '#859900',
      red: '#dc322f'
    },
    term: {
      selection: '#e0d9c3',
      normal: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#93a1a1'],
      bright: ['#586e75', '#cb4b16', '#6c8a00', '#9c7a00', '#1f78b8', '#6c71c4', '#238f86', '#657b83']
    }
  }
]

export function getTheme(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
