import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

/**
 * Loopline dark studio theme.
 * Extends the Astryx neutral theme, then re-points the system tokens at the
 * palette used by the timeline / monitor / canvas instrumentation.
 */
export const looplineTheme = defineTheme({
  name: 'loopline-studio',
  extends: neutralTheme,
  tokens: {
    '--color-accent': ['#5f7a22', '#c8ff4d'],
    '--color-accent-muted': ['#eef8d8', '#26331a'],
    '--color-on-accent': ['#0c1206', '#0c1206'],
    '--color-background-body': ['#f3f5ef', '#06080b'],
    '--color-background-surface': ['#ffffff', '#0b1016'],
    '--color-background-muted': ['#edf0e7', '#111821'],
    '--color-text-primary': ['#10160e', '#e9eff7'],
    '--color-text-secondary': ['#5b6653', '#8b9aac'],
    '--color-text-disabled': ['#98a08f', '#5d6b7c'],
    '--color-border': ['#d8decb', '#1b2431'],
    '--color-border-emphasized': ['#b9c3a8', '#263342'],
    '--color-neutral': ['rgba(20, 30, 12, 0.08)', 'rgba(200, 255, 77, 0.1)'],
    '--radius-element': '7px',
    '--radius-container': '12px',
    '--font-family-body': 'Inter, "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
    '--font-family-heading': 'Inter, "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
    '--font-family-code': '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
  },
});
