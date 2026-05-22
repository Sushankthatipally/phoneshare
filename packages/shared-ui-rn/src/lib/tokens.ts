/**
 * Design tokens for DropBeam mobile.
 * Mirrors the desktop CSS variables in @dropbeam/shared-ui/src/tokens.css so
 * the two surfaces stay visually identical. Update the CSS and these values
 * together.
 */

export const tokens = {
  color: {
    bg: '#000000',
    panelBg: 'rgba(12, 12, 12, 0.96)',
    panelBgStrong: 'rgba(8, 8, 8, 0.98)',
    panelBorder: 'rgba(255, 255, 255, 0.12)',
    panelBorderStrong: 'rgba(255, 255, 255, 0.18)',
    text: '#f4f4f4',
    textSoft: 'rgba(255, 255, 255, 0.68)',
    textDim: 'rgba(255, 255, 255, 0.48)',
    blue: '#c6e3ff',
    green: '#c7ffd4',
    amber: '#ffe2a8',
    danger: '#ff8a8a',
    overlay: 'rgba(0, 0, 0, 0.55)',
    inputBg: 'rgba(255, 255, 255, 0.04)',
    primary: '#f4f4f4',
    primaryFg: '#000000',
  },
  radius: {
    sm: 4,
    md: 6,
    lg: 8,
    xl: 10,
    pill: 999,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  fontSize: {
    eyebrow: 11,
    caption: 12,
    body: 14,
    bodyLg: 15,
    title: 20,
    titleLg: 28,
    pinDigit: 28,
  },
  fontWeight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  font: {
    sans: 'Inter',
    mono: 'JetBrainsMono-Regular',
  },
  letterSpacing: {
    eyebrow: 1.6,
    tight: -0.4,
  },
  lineHeight: {
    body: 20,
    title: 28,
  },
} as const;

export type DropBeamTokens = typeof tokens;
