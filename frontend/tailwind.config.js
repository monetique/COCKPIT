// tailwind.config.js — Design System Titanium SMT Cockpit
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // Pas de darkMode — Titanium est un thème clair unique
  theme: {
    extend: {
      colors: {
        // ── Palette Titanium ──────────────────────────────────
        primary       : '#0B264A',   // Topbar, boutons primaires, accents
        'primary-h'   : '#0d2e58',   // Hover état primaire
        secondary     : '#f59e0b',   // Accent ambre (badges, highlights)
        'clic-red'    : '#dc2626',   // Danger, alertes critiques

        // ── Surfaces ──────────────────────────────────────────
        'titanium-bg'     : '#DDE1E8',  // Fond de page
        'titanium-card'   : '#FFFFFF',  // Cards, modals
        'titanium-panel'  : '#F8FAFC',  // En-têtes de cards, panels
        'titanium-sidebar': '#EBEEF3',  // Fond sidebar

        // ── Borders & textes ──────────────────────────────────
        'titanium-border' : '#CBD5E1',  // Bordures cards
        'titanium-dark'   : '#1A2536',  // Texte principal
        'titanium-muted'  : '#5B6B82',  // Texte secondaire / labels

        // ── Tokens sémantiques (garder compat composants existants) ──
        // Ces alias permettent aux composants existants de fonctionner
        // sans modification (bg-surface → bg-titanium-card, etc.)
        bg        : '#DDE1E8',
        surface   : '#FFFFFF',
        surface2  : '#F8FAFC',
        surface3  : '#EEF2F7',
        border    : '#CBD5E1',
        border2   : '#B8C5D6',

        // Texte sémantique
        'text-primary'   : '#1A2536',
        'text-secondary' : '#5B6B82',
        'text-tertiary'  : '#8FA0B4',

        // Brand = primary dans Titanium
        brand   : '#0B264A',
        'brand-l': '#0d2e58',

        // Status
        success    : '#059669',
        'success-dim': '#ECFDF5',
        danger     : '#DC2626',
        'danger-dim' : '#FEF2F2',
        warning    : '#D97706',
        'warning-dim': '#FFFBEB',
        info       : '#2563EB',
        'info-dim'   : '#EFF6FF',
      },

      fontFamily: {
        sans   : ['Inter', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        mono   : ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        xs   : ['11px', { lineHeight: '16px' }],
        sm   : ['12px', { lineHeight: '18px' }],
        base : ['13px', { lineHeight: '20px' }],
        md   : ['14px', { lineHeight: '22px' }],
        lg   : ['16px', { lineHeight: '24px' }],
        xl   : ['18px', { lineHeight: '28px' }],
        '2xl': ['22px', { lineHeight: '32px' }],
      },

      boxShadow: {
        'card'      : '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
        'xs'        : '0 1px 2px rgba(0,0,0,0.05)',
        'topbar'    : '0 1px 4px rgba(11,38,74,0.18)',
        'modal'     : '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
      },

      borderRadius: {
        DEFAULT: '8px',
        lg     : '12px',
        xl     : '16px',
      },

      spacing: {
        sidebar        : '240px',   // w-60
        'sidebar-collapsed': '56px', // w-14
        topbar         : '56px',    // h-14
      },
    },
  },
  plugins: [],
};
