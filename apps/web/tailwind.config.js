/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      boxShadow: {
        panel: '0 1px 0 rgb(15 23 42 / 0.04), 0 12px 32px -24px rgb(15 23 42 / 0.35)',
        'panel-dark': '0 1px 0 rgb(255 255 255 / 0.03), 0 18px 40px -28px rgb(0 0 0 / 0.65)'
      },
      colors: {
        console: {
          950: '#050816',
          900: '#070B17',
          850: '#0B1020',
          800: '#111827',
          700: '#1A2338',
          600: '#243049',
          500: '#334155',
          400: '#64748B',
          300: '#94A3B8',
          200: '#CBD5E1',
          100: '#E2E8F0',
          50: '#F4F6FA'
        },
        accent: {
          DEFAULT: '#2F6FED',
          soft: '#3B82F6',
          muted: 'rgba(47, 111, 237, 0.14)',
          ring: 'rgba(47, 111, 237, 0.35)'
        },
        brand: { 50: '#eff6ff', 500: '#2F6FED', 600: '#2563EB', 700: '#1D4ED8' }
      },
      keyframes: {
        'status-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' }
        }
      },
      animation: {
        'status-pulse': 'status-pulse 2.4s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
