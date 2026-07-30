export const theme = {
  background: '#2D3441',
  // surface: '#111722',
  surface: '#2D3441',
  // surfaceRaised: '#17202E',
  surfaceRaised: '#1F2226',
  // border: '#344055',
  border: '#666666',
  borderFocused: '#5EEAD4',
  text: '#E6EDF7',
  textMuted: '#7F8CA3',
  accent: '#5EEAD4',
  accentStrong: '#2DD4BF',
  info: '#93C5FD',
  warning: '#FBBF24',
  error: '#FB7185',
  success: '#4ADE80'
} as const

export type ThemeColor = (typeof theme)[keyof typeof theme]
