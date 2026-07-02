import { Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

// ─── Color Palette ───────────────────────────────────────────────────────────
export const colors = {
  // Primary gradient
  primary: '#6C63FF',
  primaryLight: '#8B85FF',
  primaryDark: '#4A42E0',

  // Accent
  accent: '#00D9A6',
  accentLight: '#33E4BC',
  accentDark: '#00B88A',

  // Status
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',

  // Dark theme surfaces
  bg: '#0F0F1A',
  surface: '#1A1A2E',
  surfaceLight: '#242440',
  surfaceElevated: '#2A2A4A',
  card: 'rgba(30, 30, 55, 0.85)',
  cardBorder: 'rgba(108, 99, 255, 0.15)',

  // Text
  textPrimary: '#F0F0FF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  textInverse: '#0F0F1A',

  // Misc
  divider: 'rgba(255, 255, 255, 0.06)',
  overlay: 'rgba(0, 0, 0, 0.5)',
  shimmer: 'rgba(108, 99, 255, 0.08)',
};

// ─── Spacing ─────────────────────────────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

// ─── Typography ──────────────────────────────────────────────────────────────
export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, color: colors.textPrimary, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '600' as const, color: colors.textPrimary, letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: '600' as const, color: colors.textPrimary },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.textPrimary, lineHeight: 22 },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, color: colors.textSecondary, lineHeight: 18 },
  caption: { fontSize: 11, fontWeight: '500' as const, color: colors.textMuted, letterSpacing: 0.5 },
  label: { fontSize: 13, fontWeight: '600' as const, color: colors.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 1 },
};

// ─── Shadows ─────────────────────────────────────────────────────────────────
export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  small: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
};

// ─── Border Radius ───────────────────────────────────────────────────────────
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

// ─── Screen Dimensions ──────────────────────────────────────────────────────
export const screen = { width, height };
