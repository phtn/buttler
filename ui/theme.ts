export const theme = {
  background: "#0B0E14",
  surface: "#111722",
  surfaceRaised: "#17202E",
  border: "#344055",
  borderFocused: "#5EEAD4",
  text: "#E6EDF7",
  textMuted: "#7F8CA3",
  accent: "#5EEAD4",
  accentStrong: "#2DD4BF",
  info: "#93C5FD",
  warning: "#FBBF24",
  error: "#FB7185",
  success: "#4ADE80",
} as const;

export type ThemeColor = (typeof theme)[keyof typeof theme];
