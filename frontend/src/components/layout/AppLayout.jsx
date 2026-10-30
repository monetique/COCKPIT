// src/components/layout/AppLayout.jsx — Design Titanium
import { useState }     from 'react';
import { Outlet }       from 'react-router-dom';
import Sidebar          from './Sidebar';
import useAuthStore     from '@/store/authStore';
import clsx             from 'clsx';

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuthStore();

  // Initiales de l'utilisateur pour l'avatar
  const initials = [user?.prenom?.[0], user?.nom?.[0]].filter(Boolean).join('').toUpperCase();

  // Couleur du badge de rôle
  const roleBadge = {
    admin      : { bg: 'bg-[#EEF2FF]', text: 'text-[#4F46E5]', label: 'Admin' },
    directeur  : { bg: 'bg-[#F0FDF4]', text: 'text-[#059669]', label: 'Directeur' },
    pilotage   : { bg: 'bg-[#FFFBEB]', text: 'text-[#D97706]', label: 'Pilotage' },
    operateur  : { bg: 'bg-[#EFF6FF]', text: 'text-[#2563EB]', label: 'Opérateur' },
    banquier   : { bg: 'bg-[#FFF7ED]', text: 'text-[#C2410C]', label: 'Banquier' },
    dg         : { bg: 'bg-[#0B264A]/10', text: 'text-[#0B264A]', label: 'DG' },
    lecteur    : { bg: 'bg-[#EEF2F7]', text: 'text-[#5B6B82]', label: 'Lecteur' },
  }[user?.role] ?? { bg: 'bg-[#EEF2F7]', text: 'text-[#5B6B82]', label: user?.role ?? '—' };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#DDE1E8' }}>

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />

      {/* ── Contenu principal ──────────────────────────────────── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* ── Topbar ─────────────────────────────────────────────
            Fond primary #0B264A — texte blanc
        ──────────────────────────────────────────────────────── */}
        <header
          className="h-14 flex items-center justify-between px-5 shrink-0"
          style={{
            background: '#0B264A',
            boxShadow : '0 1px 4px rgba(11,38,74,0.25)',
          }}
        >
          {/* Gauche : barre de recherche */}
          <div className="flex items-center gap-3">
            <div className="relative hidden md:block">
              <span className="material-symbols-outlined ms-xs absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40">
                search
              </span>
              <input
                type="text"
                placeholder="Recherche rapide…"
                className="h-8 pl-8 pr-3 w-56 text-xs rounded-lg
                           bg-white/10 border border-white/15
                           text-white placeholder-white/40
                           focus:bg-white/15 focus:border-white/30 focus:outline-none
                           transition-colors duration-150"
              />
            </div>
          </div>

          {/* Droite : notifications + avatar */}
          <div className="flex items-center gap-2">

            {/* Bouton notifications */}
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg
                         text-white/60 hover:text-white hover:bg-white/10
                         transition-colors relative"
              title="Notifications"
            >
              <span className="material-symbols-outlined ms-sm">notifications</span>
            </button>

            {/* Séparateur */}
            <div className="w-px h-5 bg-white/15 mx-1" />

            {/* Avatar + infos utilisateur */}
            <div className="flex items-center gap-2.5">
              {/* Avatar circulaire */}
              <div className="w-7 h-7 rounded-full flex items-center justify-center
                              text-[11px] font-bold text-white shrink-0
                              border border-white/25"
                   style={{ background: 'rgba(245,158,11,0.8)' }}>
                {initials || (
                  <span className="material-symbols-outlined ms-xs">person</span>
                )}
              </div>

              {/* Nom + rôle */}
              <div className="hidden md:block leading-none">
                <div className="text-xs font-semibold text-white leading-tight">
                  {user?.prenom} {user?.nom}
                </div>
                <div className={clsx(
                  'inline-flex items-center mt-0.5 px-1.5 py-0 rounded text-[9px] font-bold uppercase tracking-wider',
                  roleBadge.bg, roleBadge.text
                )}>
                  {roleBadge.label}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ── Page courante ───────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
