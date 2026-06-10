// src/store/themeStore.js — Gestion du thème dark/light
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: 'dark',   // 'dark' | 'light'

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },

      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        set({ theme: next });
        applyTheme(next);
      },

      initTheme: () => {
        applyTheme(get().theme);
      },
    }),
    {
      name: 'ctp-theme',
    }
  )
);

function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'light') {
    html.classList.remove('dark');
    html.classList.add('light');
  } else {
    html.classList.remove('light');
    html.classList.add('dark');
  }
}

export default useThemeStore;
