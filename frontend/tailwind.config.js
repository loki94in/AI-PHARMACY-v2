/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        bg2: 'var(--bg2)',
        bg3: 'var(--bg3)',
        border: 'var(--border)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        primary: {
          DEFAULT: '#3b82f6',
          glow: 'rgba(59, 130, 246, 0.4)',
        },
        sky: {
          DEFAULT: '#0ea5e9',
          bg: 'rgba(14, 165, 233, 0.15)',
        },
        green: {
          DEFAULT: '#10b981',
          bg: 'rgba(16, 185, 129, 0.15)',
          glow: 'rgba(16, 185, 129, 0.4)',
        },
        red: {
          DEFAULT: '#ef4444',
          bg: 'rgba(239, 68, 68, 0.15)',
          glow: 'rgba(239, 68, 68, 0.4)',
        },
        amber: {
          DEFAULT: '#f59e0b',
          bg: 'rgba(245, 158, 11, 0.15)',
        },
        glass: {
          bg: 'var(--glass-bg)',
          border: 'var(--glass-border)',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      zIndex: {
        'dropdown': '999',
        'sticky-header': '1000',
        'drawer': '9000',
        'modal': '9999',
        'global-modal': '10000',
        'camera': '10010',
        'toast': '10020',
      }
    },
  },
  plugins: [],
}
