/** @type {import('tailwindcss').Config} */
export default {
  content : ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Surfaces (dark) ──────────────────────────────
        bg       : 'var(--color-bg)',
        surface  : 'var(--color-surface)',
        surface2 : 'var(--color-surface2)',
        surface3 : 'var(--color-surface3)',
        // ── Borders ──────────────────────────────────────
        border   : 'var(--color-border)',
        border2  : 'var(--color-border2)',
        // ── Brand ────────────────────────────────────────
        navy     : '#0f2444',
        brand    : '#1d4ed8',
        'brand-l': '#3b6fec',
        // ── Semantic ─────────────────────────────────────
        success      : '#10b981',
        'success-dim': 'rgba(16,185,129,0.12)',
        warning      : '#f59e0b',
        'warning-dim': 'rgba(245,158,11,0.12)',
        danger       : '#ef4444',
        'danger-dim' : 'rgba(239,68,68,0.12)',
        info         : '#3b82f6',
        'info-dim'   : 'rgba(59,130,246,0.12)',
        // ── Text ─────────────────────────────────────────
        primary  : 'var(--color-primary)',
        secondary: 'var(--color-secondary)',
        tertiary : 'var(--color-tertiary)',
      },
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
        mono: ['"DM Mono"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        lg     : '12px',
        xl     : '16px',
      },
      boxShadow: {
        card : 'var(--shadow-card)',
        glow : '0 0 24px rgba(29,78,216,0.15)',
      },
      animation: {
        'fade-in'  : 'fadeIn .25s ease',
        'slide-up' : 'slideUp .3s ease',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        fadeIn  : { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp : { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
