// src/components/layout/Sidebar.jsx — Restructurée v2
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, ArrowLeftRight, Globe2, Shield,
  Store, CheckSquare, Landmark, Bell, GraduationCap,
  Settings, LogOut, ChevronRight, FileText, Sun, Moon,
  GitMerge, Receipt, CreditCard, Tag, BarChart2,
  TrendingUp, Zap, Lock, Database, BookOpen, AlertTriangle,
  Wrench, Users, Target
} from 'lucide-react';
import useAuthStore  from '@/store/authStore';
import useThemeStore from '@/store/themeStore';
import { logout }    from '@/api/auth';
import client        from '@/api/client';
import toast         from 'react-hot-toast';
import clsx          from 'clsx';

// ── Structure de navigation par groupes ──────────────────────
const NAV_GROUPS = [
  {
    label: 'Supervision',
    items: [
      { to:'/dashboard',          icon:LayoutDashboard, label:'Dashboard',           roles:['admin','directeur','pilotage','operateur','lecteur','dg'] },
      { to:'/transactions',       icon:ArrowLeftRight,  label:'ClicToPay',           roles:['admin','directeur','pilotage','operateur','lecteur'] },
      { to:'/paysmart',           icon:Globe2,          label:'Paysmart',            roles:['admin','directeur','pilotage','operateur','lecteur'] },
      { to:'/acs',                icon:Shield,          label:'ACS Metrics',         roles:['admin','directeur','pilotage','operateur','lecteur'] },
    ]
  },
  {
    label: 'Gestion commerciale',
    items: [
      { to:'/merchants',          icon:Store,           label:'Marchands',           roles:['admin','directeur','pilotage','operateur','banquier'] },
      { to:'/validation',         icon:CheckSquare,     label:'Validation',          roles:['admin','directeur','pilotage','operateur','banquier'] },
      { to:'/banques-dashboard',  icon:Landmark,        label:'Vue banques',         roles:['admin','directeur','pilotage','banquier'] },
      { to:'/inscriptions',       icon:GraduationCap,   label:'Inscriptions CNTE',   roles:['admin','directeur','pilotage'] },
    ]
  },
  {
    label: 'Facturation',
    items: [
      { to:'/psm-facturation',    icon:CreditCard,      label:'Facturation PSM',     roles:['admin','directeur','pilotage'] },
      { to:'/facturation',        icon:Receipt,         label:'Facturation CNTE',    roles:['admin','directeur','pilotage'] },
      { to:'/rapports',           icon:FileText,        label:'Rapports PDF',        roles:['admin','directeur','pilotage'] },
    ]
  },
  {
    label: 'Réconciliation',
    items: [
      { to:'/reconciliation',     icon:GitMerge,        label:'Réconciliation',      roles:['admin','directeur','pilotage'] },
    ]
  },
  {
    label: 'Stratégie 2027-2030',
    items: [
      { to:'/strategie',          icon:BarChart2,       label:'Synthèse DG',         roles:['admin','directeur','dg','pilotage'] },
      { to:'/strategie/switch',   icon:Zap,             label:'Switch national',     roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/tunpay',   icon:TrendingUp,      label:'TUNPAY',              roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/ctp',      icon:Lock,            label:'ClicToPay',           roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/data',     icon:Database,        label:'Data & Fraude',       roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/openbanking', icon:Globe2,       label:'Open Banking',        roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/paysmart', icon:Globe2,          label:'Paysmart',            roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/programmes', icon:BookOpen,      label:'Programmes de place', roles:['admin','directeur','pilotage'] },
      { to:'/strategie/incidents', icon:AlertTriangle,  label:'Incidents & MTTR',    roles:['admin','directeur','chef_division','pilotage'] },
      { to:'/strategie/baselines',   icon:Target,         label:'Baselines & Cibles',  roles:['admin','directeur','pilotage'] },
      { to:'/strategie/fournisseurs', icon:Wrench,      label:'Fournisseurs / BPC',  roles:['admin','directeur','pilotage'] },
    ]
  },
  {
    label: 'Administration',
    items: [
      { to:'/banks',              icon:Landmark,        label:'Banques',             roles:['admin'] },
      { to:'/alerts',             icon:Bell,            label:'Alertes',             roles:['admin'] },
      { to:'/users',              icon:Users,           label:'Utilisateurs',        roles:['admin'] },
      { to:'/logs',               icon:FileText,        label:'Journaux',            roles:['admin'] },
      { to:'/version',            icon:Tag,             label:'Versions',            roles:['admin','directeur'] },
      { to:'/settings',           icon:Settings,        label:'Paramètres',          roles:['admin'] },
    ]
  },
];

export default function Sidebar({ collapsed, onToggle }) {
  const { user, logout: storeLogout, refreshToken } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
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
      'flex flex-col h-screen bg-surface border-r border-border',
      'transition-all duration-200 ease-in-out shrink-0',
      collapsed ? 'w-14' : 'w-60'
    )}>

      {/* Logo + toggle */}
      <div className="flex items-center justify-between h-14 px-3 border-b border-border shrink-0">
        {!collapsed && (
          <span className="text-sm font-bold text-primary tracking-tight">SMT Cockpit</span>
        )}
        <button onClick={onToggle}
          className="p-1.5 rounded hover:bg-surface-hover text-tertiary transition-colors ml-auto">
          <ChevronRight size={16} className={clsx('transition-transform', !collapsed && 'rotate-180')}/>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-0.5 px-1.5">
        {NAV_GROUPS.map(group => {
          const visibleItems = group.items.filter(item => canSee(item.roles));
          if (!visibleItems.length) return null;
          return (
            <div key={group.label} className="mb-1">
              {/* Label de groupe */}
              {!collapsed && (
                <div className="px-2 py-1.5 text-[10px] font-semibold text-tertiary uppercase tracking-widest">
                  {group.label}
                </div>
              )}
              {collapsed && <div className="border-t border-border my-1"/>}
              {/* Items */}
              {visibleItems.map(item => (
                <NavLink key={item.to} to={item.to} end={item.to === '/dashboard'}
                  className={({ isActive }) => clsx(
                    'flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors',
                    'hover:bg-surface-hover',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-secondary',
                    collapsed && 'justify-center'
                  )}>
                  <item.icon size={15} className="shrink-0"/>
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      {/* Footer : thème + déconnexion + badge version */}
      <div className="border-t border-border p-2 shrink-0 space-y-1">

        {/* Thème */}
        <button onClick={toggleTheme}
          className="flex items-center gap-2.5 px-2 py-1.5 rounded text-sm text-secondary hover:bg-surface-hover w-full transition-colors">
          {theme === 'dark'
            ? <Sun size={15} className="shrink-0"/>
            : <Moon size={15} className="shrink-0"/>}
          {!collapsed && <span>{theme === 'dark' ? 'Mode clair' : 'Mode sombre'}</span>}
        </button>

        {/* Déconnexion */}
        <button onClick={handleLogout}
          className="flex items-center gap-2.5 px-2 py-1.5 rounded text-sm text-secondary hover:bg-surface-hover w-full transition-colors">
          <LogOut size={15} className="shrink-0"/>
          {!collapsed && <span>Déconnexion</span>}
        </button>

        {/* Badge version */}
        {!collapsed && versionData?.version && (
          <div className="flex items-center gap-1.5 px-2 pt-1 pb-0.5">
            <Tag size={10} className="text-tertiary shrink-0"/>
            <span className="text-[10px] font-mono text-tertiary">
              v{versionData.version}
            </span>
          </div>
        )}
        {collapsed && versionData?.version && (
          <div className="flex justify-center py-0.5" title={`v${versionData.version}`}>
            <span className="text-[9px] font-mono text-tertiary">
              v{versionData.version.split('.')[0]}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
