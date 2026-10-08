import { Theme } from '../components/ui/AppProperties';

export const THEME_TOKENS = [
  '--app-bg-primary',
  '--app-bg-secondary',
  '--app-surface',
  '--app-card-active',
  '--app-button-text',
  '--app-text-primary',
  '--app-text-secondary',
  '--app-accent',
  '--app-border-color',
  '--app-hover-color',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
export type ThemeColors = Record<ThemeToken, string>;

export enum ThemeGroup {
  Builtin = 'builtin',
  VsCode = 'vscode',
  Community = 'community',
  Neutral = 'neutral',
  Custom = 'custom',
}

export interface ThemeProps {
  colors: ThemeColors;
  group: ThemeGroup;
  id: string;
  name: string;
}

export interface CustomTheme {
  colors: ThemeColors;
  id: string;
  name: string;
}

export interface ThemeSeed {
  accent: string;
  background: string;
  text: string;
}

export interface ResolvedTheme {
  colors: ThemeColors;
  isLight: boolean;
  splashImage: string;
}

type Rgb = [number, number, number];

export const parseColor = (value: string): Rgb | null => {
  const trimmed = value.trim();
  const hex = trimmed.match(/^#?([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
};

const toRgbString = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;

const toCssColor = (value: string) => toRgbString(parseColor(value) ?? [0, 0, 0]);

export const toHexColor = (value: string): string => {
  const rgb = parseColor(value) ?? [0, 0, 0];
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

const mix = (from: string, to: string, amount: number): string => {
  const a = parseColor(from) ?? [0, 0, 0];
  const b = parseColor(to) ?? [0, 0, 0];
  return toRgbString(a.map((c, i) => Math.round(c + (b[i] - c) * amount)) as Rgb);
};

const relativeLuminance = (value: string): number => {
  const [r, g, b] = (parseColor(value) ?? [0, 0, 0]).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const getContrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const readableOn = (background: string) =>
  getContrastRatio(background, '#000000') >= getContrastRatio(background, '#ffffff')
    ? 'rgb(0, 0, 0)'
    : 'rgb(255, 255, 255)';

export const deriveThemeColors = ({ accent, background, text }: ThemeSeed): ThemeColors => ({
  '--app-bg-primary': toCssColor(background),
  '--app-bg-secondary': mix(background, text, 0.05),
  '--app-surface': mix(background, text, 0.02),
  '--app-card-active': mix(background, text, 0.09),
  '--app-button-text': readableOn(accent),
  '--app-text-primary': toCssColor(text),
  '--app-text-secondary': mix(text, background, 0.36),
  '--app-accent': toCssColor(accent),
  '--app-border-color': mix(background, text, 0.1),
  '--app-hover-color': toCssColor(accent),
});

export const getThemeSeed = (colors: ThemeColors): ThemeSeed => ({
  accent: colors['--app-accent'],
  background: colors['--app-bg-primary'],
  text: colors['--app-text-primary'],
});

const preset = (
  id: string,
  group: ThemeGroup,
  name: string,
  seed: ThemeSeed,
  overrides: Partial<ThemeColors> = {},
): ThemeProps => ({ id, group, name, colors: { ...deriveThemeColors(seed), ...overrides } });

export const THEMES: Array<ThemeProps> = [
  {
    id: Theme.Dark,
    group: ThemeGroup.Builtin,
    name: 'settings.themes.dark',
    colors: {
      '--app-bg-primary': 'rgb(24, 24, 24)',
      '--app-bg-secondary': 'rgb(35, 35, 35)',
      '--app-surface': 'rgb(28, 28, 28)',
      '--app-card-active': 'rgb(43, 43, 43)',
      '--app-button-text': 'rgb(0, 0, 0)',
      '--app-text-primary': 'rgb(232, 234, 237)',
      '--app-text-secondary': 'rgb(158, 158, 158)',
      '--app-accent': 'rgb(255, 255, 255)',
      '--app-border-color': 'rgb(45, 45, 45)',
      '--app-hover-color': 'rgb(255, 255, 255)',
    },
  },
  {
    id: Theme.Light,
    group: ThemeGroup.Builtin,
    name: 'settings.themes.light',
    colors: {
      '--app-bg-primary': 'rgb(245, 245, 245)',
      '--app-bg-secondary': 'rgb(255, 255, 255)',
      '--app-surface': 'rgb(241, 241, 241)',
      '--app-card-active': 'rgb(250, 250, 250)',
      '--app-button-text': 'rgb(255, 255, 255)',
      '--app-text-primary': 'rgb(20, 20, 20)',
      '--app-text-secondary': 'rgb(108, 108, 108)',
      '--app-accent': 'rgb(198, 142, 110)',
      '--app-border-color': 'rgb(224, 224, 224)',
      '--app-hover-color': 'rgb(198, 142, 110)',
    },
  },
  {
    id: Theme.Grey,
    group: ThemeGroup.Builtin,
    name: 'settings.themes.grey',
    colors: {
      '--app-bg-primary': 'rgb(112, 112, 112)',
      '--app-bg-secondary': 'rgb(118, 118, 118)',
      '--app-surface': 'rgb(108, 108, 108)',
      '--app-card-active': 'rgb(133, 133, 133)',
      '--app-button-text': 'rgb(45, 45, 45)',
      '--app-text-primary': 'rgb(240, 240, 240)',
      '--app-text-secondary': 'rgb(180, 180, 180)',
      '--app-accent': 'rgb(220, 220, 220)',
      '--app-border-color': 'rgb(138, 138, 138)',
      '--app-hover-color': 'rgb(220, 220, 220)',
    },
  },
  preset(
    'oled-black',
    ThemeGroup.Neutral,
    'settings.themes.oledBlack',
    { background: '#000000', text: '#e8eaed', accent: '#ffffff' },
    { '--app-bg-secondary': '#0d0d0d', '--app-surface': '#050505', '--app-border-color': '#1f1f1f' },
  ),
  preset('darkroom', ThemeGroup.Neutral, 'settings.themes.darkroom', {
    background: '#1a1816',
    text: '#e6dfd3',
    accent: '#d9a066',
  }),
  preset(
    'vscode-dark-modern',
    ThemeGroup.VsCode,
    'Dark Modern',
    { background: '#1f1f1f', text: '#cccccc', accent: '#0078d4' },
    {
      '--app-bg-secondary': '#181818',
      '--app-surface': '#1c1c1c',
      '--app-border-color': '#2b2b2b',
      '--app-text-secondary': '#9d9d9d',
      '--app-button-text': '#ffffff',
    },
  ),
  preset(
    'vscode-light-modern',
    ThemeGroup.VsCode,
    'Light Modern',
    { background: '#f8f8f8', text: '#3b3b3b', accent: '#005fb8' },
    {
      '--app-bg-secondary': '#ffffff',
      '--app-surface': '#f3f3f3',
      '--app-card-active': '#ffffff',
      '--app-border-color': '#e5e5e5',
      '--app-text-secondary': '#616161',
      '--app-button-text': '#ffffff',
    },
  ),
  preset(
    'vscode-monokai',
    ThemeGroup.VsCode,
    'Monokai',
    { background: '#272822', text: '#f8f8f2', accent: '#a6e22e' },
    { '--app-bg-secondary': '#1e1f1c', '--app-surface': '#2d2e27', '--app-card-active': '#3e3d32' },
  ),
  preset(
    'vscode-solarized-dark',
    ThemeGroup.VsCode,
    'Solarized Dark',
    { background: '#002b36', text: '#93a1a1', accent: '#268bd2' },
    { '--app-bg-secondary': '#00212b', '--app-card-active': '#073642', '--app-text-secondary': '#657b83' },
  ),
  preset(
    'vscode-solarized-light',
    ThemeGroup.VsCode,
    'Solarized Light',
    { background: '#fdf6e3', text: '#586e75', accent: '#268bd2' },
    { '--app-bg-secondary': '#eee8d5', '--app-text-secondary': '#839496', '--app-button-text': '#fdf6e3' },
  ),
  preset(
    'vscode-high-contrast',
    ThemeGroup.VsCode,
    'Dark High Contrast',
    { background: '#000000', text: '#ffffff', accent: '#f38518' },
    { '--app-border-color': '#6fc3df', '--app-text-secondary': '#d4d4d4', '--app-hover-color': '#6fc3df' },
  ),
  preset(
    'dracula',
    ThemeGroup.Community,
    'Dracula',
    { background: '#282a36', text: '#f8f8f2', accent: '#bd93f9' },
    { '--app-bg-secondary': '#21222c', '--app-card-active': '#44475a', '--app-hover-color': '#ff79c6' },
  ),
  preset(
    'nord',
    ThemeGroup.Community,
    'Nord',
    { background: '#2e3440', text: '#eceff4', accent: '#88c0d0' },
    { '--app-bg-secondary': '#3b4252', '--app-card-active': '#434c5e', '--app-border-color': '#4c566a' },
  ),
  preset(
    'one-dark',
    ThemeGroup.Community,
    'One Dark',
    { background: '#282c34', text: '#abb2bf', accent: '#61afef' },
    { '--app-bg-secondary': '#21252b', '--app-card-active': '#2c313a', '--app-text-secondary': '#7f848e' },
  ),
  preset(
    'github-dark',
    ThemeGroup.Community,
    'GitHub Dark',
    { background: '#0d1117', text: '#e6edf3', accent: '#2f81f7' },
    {
      '--app-bg-secondary': '#161b22',
      '--app-card-active': '#21262d',
      '--app-border-color': '#30363d',
      '--app-text-secondary': '#7d8590',
      '--app-button-text': '#ffffff',
    },
  ),
  preset(
    'github-light',
    ThemeGroup.Community,
    'GitHub Light',
    { background: '#ffffff', text: '#1f2328', accent: '#0969da' },
    {
      '--app-bg-secondary': '#f6f8fa',
      '--app-border-color': '#d0d7de',
      '--app-text-secondary': '#656d76',
      '--app-button-text': '#ffffff',
    },
  ),
  preset(
    'catppuccin-mocha',
    ThemeGroup.Community,
    'Catppuccin Mocha',
    { background: '#1e1e2e', text: '#cdd6f4', accent: '#cba6f7' },
    {
      '--app-bg-secondary': '#181825',
      '--app-card-active': '#313244',
      '--app-border-color': '#45475a',
      '--app-text-secondary': '#a6adc8',
      '--app-button-text': '#1e1e2e',
    },
  ),
  preset(
    'catppuccin-latte',
    ThemeGroup.Community,
    'Catppuccin Latte',
    { background: '#eff1f5', text: '#4c4f69', accent: '#8839ef' },
    {
      '--app-bg-secondary': '#e6e9ef',
      '--app-card-active': '#ccd0da',
      '--app-border-color': '#bcc0cc',
      '--app-text-secondary': '#6c6f85',
      '--app-button-text': '#eff1f5',
    },
  ),
  preset(
    'gruvbox-dark',
    ThemeGroup.Community,
    'Gruvbox Dark',
    { background: '#282828', text: '#ebdbb2', accent: '#fabd2f' },
    {
      '--app-bg-secondary': '#1d2021',
      '--app-card-active': '#3c3836',
      '--app-border-color': '#504945',
      '--app-text-secondary': '#a89984',
      '--app-button-text': '#282828',
    },
  ),
];

export const DEFAULT_THEME_ID: string = Theme.Dark;

export const THEME_GROUP_ORDER = [
  ThemeGroup.Builtin,
  ThemeGroup.Neutral,
  ThemeGroup.VsCode,
  ThemeGroup.Community,
  ThemeGroup.Custom,
];

export const customThemeToProps = (theme: CustomTheme): ThemeProps => ({ ...theme, group: ThemeGroup.Custom });

export const getAllThemes = (customThemes: Array<CustomTheme> = []): Array<ThemeProps> => [
  ...THEMES,
  ...customThemes.map(customThemeToProps),
];

const normalizeColors = (colors: ThemeColors): ThemeColors =>
  Object.fromEntries(THEME_TOKENS.map((token) => [token, toCssColor(colors[token] ?? '')])) as ThemeColors;

const getSplashTone = (colors: ThemeColors) => {
  const luminance = relativeLuminance(colors['--app-bg-primary']);
  if (luminance > 0.5) return 'light';
  if (luminance > 0.1) return 'grey';
  return 'dark';
};

export const resolveTheme = (
  id: string,
  customThemes: Array<CustomTheme> = [],
  preview: ThemeColors | null = null,
): ResolvedTheme => {
  const themes = getAllThemes(customThemes);
  const theme = themes.find((t) => t.id === id) || themes.find((t) => t.id === DEFAULT_THEME_ID) || THEMES[0];
  const colors = normalizeColors(preview ?? theme.colors);
  const tone = getSplashTone(colors);
  return { colors, isLight: tone === 'light', splashImage: `/splash-${tone}.jpg` };
};

export const parseThemeColors = (value: unknown): ThemeColors | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const entries = THEME_TOKENS.map((token) => {
    const color = source[token];
    return typeof color === 'string' && parseColor(color) ? [token, toHexColor(color)] : null;
  });
  return entries.every(Boolean) ? (Object.fromEntries(entries as Array<[string, string]>) as ThemeColors) : null;
};
