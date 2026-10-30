// src/components/layout/Sidebar.jsx — Design Titanium
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import useAuthStore  from '@/store/authStore';
import { logout }    from '@/api/auth';
import client        from '@/api/client';
import toast         from 'react-hot-toast';
import clsx          from 'clsx';

// ── Structure de navigation par groupes ──────────────────────────
const NAV_GROUPS = [
  {
    label: 'Supervision',
    items: [
      { to:'/dashboard',          icon:'dashboard',        label:'Dashboard',           roles:['admin','directeur','pilotage','operateur','lecteur','dg'] },
      { to:'/transactions',       icon:'swap_horiz',       label:'ClicToPay',           roles:['admin','directeur','pilotage','operateur','lecteur'] },
      { to:'/paysmart',           icon:'language',         label:'Paysmart',            roles:['admin','directeur','pilotage','operateur','lecteur'] },
      { to:'/acs',                icon:'verified_user',    label:'ACS Metrics',         roles:['admin','directeur','pilotage','operateur','lecteur'] },
    ]
  },
  {
    label: 'Gestion commerciale',
    items: [
      { to:'/merchants',          icon:'store',            label:'Marchands',           roles:['admin','directeur','pilotage','operateur','banquier'] },
      { to:'/validation',         icon:'fact_check',       label:'Validation',          roles:['admin','directeur','pilotage','operateur','banquier'] },
      { to:'/banques-dashboard',  icon:'account_balance',  label:'Vue banques',         roles:['admin','directeur','pilotage','banquier'] },
      { to:'/inscriptions',       icon:'school',           label:'Inscriptions CNTE',   roles:['admin','directeur','pilotage'] },
    ]
  },
  {
    label: 'Facturation',
    items: [
      { to:'/psm-facturation',    icon:'credit_card',      label:'Facturation PSM',     roles:['admin','directeur','pilotage'] },
      { to:'/facturation',        icon:'receipt_long',     label:'Facturation CNTE',    roles:['admin','directeur','pilotage'] },
      { to:'/rapports',           icon:'description',      label:'Rapports PDF',        roles:['admin','directeur','pilotage'] },
    ]
  },
  {
    label: 'Réconciliation',
    items: [
      { to:'/reconciliation',     icon:'merge',            label:'Réconciliation',      roles:['admin','directeur','pilotage'] },
    ]
  },
  {
    label: 'Stratégie 2027-2030',
    items: [
      { to:'/strategie',          icon:'bar_chart',        label:'Synthèse DG',         roles:['admin','directeur','dg','pilotage'] },
      { to:'/strategie/switch',   icon:'bolt',             label:'Switch national',     roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/tunpay',   icon:'trending_up',      label:'TUNPAY',              roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/ctp',      icon:'lock',             label:'ClicToPay',           roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/data',     icon:'storage',          label:'Data & Fraude',       roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/openbanking', icon:'open_in_new',   label:'Open Banking',        roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/paysmart', icon:'language',         label:'Paysmart',            roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/programmes', icon:'menu_book',      label:'Programmes de place', roles:['admin','directeur','pilotage'] },
      { to:'/strategie/incidents', icon:'warning',         label:'Incidents & MTTR',    roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/baselines',   icon:'my_location',   label:'Baselines & Cibles',  roles:['admin','directeur','pilotage'] },
      { to:'/strategie/fournisseurs', icon:'build',        label:'Fournisseurs / BPC',  roles:['admin','directeur','pilotage'] },
    ]
  },
  {
    label: 'Administration',
    items: [
      { to:'/banks',              icon:'account_balance',  label:'Banques',             roles:['admin'] },
      { to:'/alerts',             icon:'notifications',    label:'Alertes',             roles:['admin'] },
      { to:'/users',              icon:'group',            label:'Utilisateurs',        roles:['admin'] },
      { to:'/logs',               icon:'receipt',          label:'Journaux',            roles:['admin'] },
      { to:'/version',            icon:'sell',             label:'Versions',            roles:['admin','directeur'] },
      { to:'/settings',           icon:'settings',         label:'Paramètres',          roles:['admin'] },
    ]
  },
];

export default function Sidebar({ collapsed, onToggle }) {
  const { user, logout: storeLogout, refreshToken } = useAuthStore();
  const navigate = useNavigate();

  // Version courante — appel léger toutes les 5 min
  const { data: versionData } = useQuery({
    queryKey: ['version-current'],
    queryFn : () => client.get('/version/current').then(r => r.data),
    staleTime: 5 * 60 * 1000,
    retry   : false,
  });

  const handleLogout = async () => {
    try { await logout(refreshToken); } catch {}
    storeLogout();
    toast.success('Déconnecté');
    navigate('/login', { replace: true });
  };

  const canSee = (roles) => roles.includes(user?.role);

  return (
    <aside className={clsx(
      'flex flex-col h-screen shrink-0',
      'border-r border-[#D1D9E3]',
      'transition-all duration-200 ease-in-out',
      collapsed ? 'w-14' : 'w-60'
    )}
    style={{ background: '#EBEEF3' }}>

      {/* ── Logo + toggle ──────────────────────────────────────── */}
      <div className={clsx(
        'flex items-center h-14 px-3 border-b border-[#D1D9E3] shrink-0',
        collapsed ? 'justify-center' : 'justify-between'
      )}>
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined ms-filled text-[#0B264A] text-xl">hub</span>
            <span className="font-display font-black text-sm text-[#0B264A] tracking-tight truncate">
              SMT Cockpit
            </span>
          </div>
        )}
        <button
          onClick={onToggle}
          title={collapsed ? 'Agrandir' : 'Réduire'}
          className={clsx(
            'w-7 h-7 flex items-center justify-center rounded-lg',
            'text-[#5B6B82] hover:text-[#0B264A] hover:bg-white/60',
            'transition-colors shrink-0',
            collapsed && 'mx-auto'
          )}
        >
          <span className={clsx(
            'material-symbols-outlined ms-sm transition-transform duration-200',
            !collapsed && 'rotate-180'
          )}>
            chevron_right
          </span>
        </button>
      </div>

      {/* ── Navigation ─────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
        {NAV_GROUPS.map(group => {
          const visibleItems = group.items.filter(item => canSee(item.roles));
          if (!visibleItems.length) return null;
          return (
            <div key={group.label} className="mb-1">
              {/* Label de groupe */}
              {!collapsed ? (
                <div className="px-2.5 py-1.5 text-[9px] font-bold text-[#8FA0B4] uppercase tracking-widest">
                  {group.label}
                </div>
              ) : (
                <div className="border-t border-[#D1D9E3] my-1.5 mx-1" />
              )}

              {/* Items */}
              {visibleItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/dashboard'}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) => clsx(
                    'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150',
                    collapsed && 'justify-center px-2',
                    isActive
                      ? 'bg-white text-[#0B264A] font-semibold border-l-2 border-[#0B264A]'
                      : 'text-[#5B6B82] hover:text-[#1A2536] hover:bg-white/60'
                  )}
                  style={({ isActive }) => isActive ? { boxShadow: '0 1px 3px rgba(0,0,0,0.06)' } : {}}
                >
                  <span className={clsx(
                    'material-symbols-outlined ms-sm shrink-0',
                    'transition-none'
                  )}>
                    {item.icon}
                  </span>
                  {!collapsed && (
                    <span className="truncate text-xs">{item.label}</span>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div className="border-t border-[#D1D9E3] p-2 shrink-0 space-y-0.5">

        {/* Déconnexion */}
        <button
          onClick={handleLogout}
          className={clsx(
            'flex items-center gap-2.5 px-2.5 py-2 rounded-lg w-full',
            'text-xs text-[#5B6B82] hover:text-[#DC2626] hover:bg-[#FEF2F2]',
            'transition-colors',
            collapsed && 'justify-center'
          )}
          title={collapsed ? 'Déconnexion' : undefined}
        >
          <span className="material-symbols-outlined ms-sm shrink-0">logout</span>
          {!collapsed && <span>Déconnexion</span>}
        </button>

        {/* Badge version */}
        {!collapsed && versionData?.version && (
          <div className="flex items-center gap-1.5 px-2.5 py-1">
            <span className="material-symbols-outlined ms-xs text-[#8FA0B4]">sell</span>
            <span className="text-[9px] font-mono text-[#8FA0B4]">
              v{versionData.version}
            </span>
          </div>
        )}
        {collapsed && versionData?.version && (
          <div className="flex justify-center py-1" title={`v${versionData.version}`}>
            <span className="text-[9px] font-mono text-[#8FA0B4]">
              v{versionData.version.split('.')[0]}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
