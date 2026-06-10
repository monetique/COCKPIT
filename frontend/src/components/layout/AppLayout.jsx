// src/components/layout/AppLayout.jsx
import { useState }      from 'react';
import { Outlet }        from 'react-router-dom';
import { Bell, Search }  from 'lucide-react';
import Sidebar           from './Sidebar';
import useAuthStore      from '@/store/authStore';

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuthStore();

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />

      {/* Contenu principal */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Header */}
        <header className="h-14 border-b border-border bg-surface flex items-center
                           justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            {/* Barre de recherche rapide */}
            <div className="relative hidden md:block">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
              <input
                type="text"
                placeholder="Recherche rapide…"
                className="input pl-8 py-1.5 w-64 text-xs h-8"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Notifications */}
            <button className="w-8 h-8 flex items-center justify-center rounded-lg
                               text-tertiary hover:text-primary hover:bg-surface3
                               transition-colors relative">
              <Bell size={15} />
            </button>

            {/* Avatar utilisateur */}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-brand/20 border border-brand/30
                              flex items-center justify-center text-xs font-semibold text-brand">
                {user?.prenom?.[0]}{user?.nom?.[0]}
              </div>
              <div className="hidden md:block">
                <div className="text-xs font-medium text-primary leading-tight">
                  {user?.prenom} {user?.nom}
                </div>
                <div className="text-xs text-tertiary">{user?.role}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Page courante */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
