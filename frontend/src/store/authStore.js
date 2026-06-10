// src/store/authStore.js — État d'authentification global
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useAuthStore = create(
  persist(
    (set, get) => ({
      user        : null,
      accessToken : null,
      refreshToken: null,
      isAuth      : false,

      setAuth: ({ user, accessToken, refreshToken }) => {
        localStorage.setItem('ctp_access_token',  accessToken);
        localStorage.setItem('ctp_refresh_token', refreshToken);
        set({ user, accessToken, refreshToken, isAuth: true });
      },

      setUser: (user) => set({ user }),

      logout: () => {
        localStorage.removeItem('ctp_access_token');
        localStorage.removeItem('ctp_refresh_token');
        set({ user: null, accessToken: null, refreshToken: null, isAuth: false });
      },

      isAdmin:     () => get().user?.role === 'admin',
      isOperateur: () => ['admin','operateur'].includes(get().user?.role),
    }),
    {
      name   : 'ctp-auth',
      partialize: (s) => ({
        user: s.user, accessToken: s.accessToken,
        refreshToken: s.refreshToken, isAuth: s.isAuth
      }),
    }
  )
);

export default useAuthStore;
