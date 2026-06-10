// src/components/layout/Sidebar.jsx
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ArrowLeftRight, Globe2, Shield,
  Store, CheckSquare, Landmark, Bell,
  Settings, LogOut, ChevronRight, FileText, Sun, Moon
} from 'lucide-react';
import useAuthStore  from '@/store/authStore';
import useThemeStore from '@/store/themeStore';
import { logout }    from '@/api/auth';
import toast         from 'react-hot-toast';
import clsx          from 'clsx';

const NAV = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard'     },
  { to: '/transactions',  icon: ArrowLeftRight,  label: 'CLICTOPAY'  },
  { to: '/paysmart',      icon: Globe2,          label: 'PAYSMART'      },
  { to: '/acs',           icon: Shield,          label: 'ACS Metrics'   },
  { sep: true },
  { to: '/merchants',     icon: Store,           label: 'Marchands'     },
  { to: '/validation',    icon: CheckSquare,     label: 'Validation'    },
  { sep: true },
  { to: '/banks',         icon: Landmark,        label: 'Banques',      role: 'admin' },
  { to: '/alerts',        icon: Bell,            label: 'Alertes',      role: 'admin' },
  { to: '/logs',          icon: FileText,        label: 'Journaux',     role: 'admin' },
  { to: '/settings',      icon: Settings,        label: 'Paramètres',   role: 'admin' },
];

export default function Sidebar({ collapsed, onToggle }) {
  const { user, logout: storeLogout, refreshToken, isAdmin } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try { await logout(refreshToken); } catch {}
    storeLogout();
    toast.success('Déconnecté');
    navigate('/login', { replace: true });
  };

  return (
    <aside className={clsx(
      'flex flex-col h-screen bg-surface border-r border-border',
      'transition-all duration-200 ease-in-out shrink-0',
      collapsed ? 'w-14' : 'w-56'
    )}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-border shrink-0">
        <div className="flex flex-col gap-0.5 shrink-0">
          <div className="flex gap-0.5">
            <div className="w-2 h-2 rounded-sm bg-brand" />
            <div className="w-2 h-2 rounded-sm bg-brand-l opacity-60" />
          </div>
          <div className="flex gap-0.5">
            <div className="w-2 h-2 rounded-sm bg-brand opacity-40" />
            <div className="w-2 h-2 rounded-sm bg-success" />
          </div>
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <div className="text-sm font-semibold text-primary leading-tight truncate">ClicToPay</div>
            <div className="text-xs text-tertiary truncate">SMT COCKPIT v2</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV.map((item, idx) => {
          if (item.sep) return (
            <div key={idx} className="my-2 border-t border-border" />
          );
          if (item.role === 'admin' && !isAdmin()) return null;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => clsx(
                'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium',
                'transition-all duration-100 group relative',
                isActive
                  ? 'text-primary bg-surface3 border-l-2 border-brand pl-[10px]'
                  : 'text-secondary hover:text-primary hover:bg-surface3'
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={16} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {/* Tooltip si collapsed */}
              {collapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-surface3 border border-border2
                               rounded text-xs text-primary whitespace-nowrap
                               opacity-0 group-hover:opacity-100 pointer-events-none
                               transition-opacity z-50">
                  {item.label}
                </div>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* User + Logout */}
      <div className="border-t border-border p-2 shrink-0">
        {!collapsed && (
          <div className="px-3 py-2 mb-1">
            <div className="text-xs font-medium text-primary truncate">
              {user?.prenom} {user?.nom}
            </div>
            <div className="text-xs text-tertiary truncate">{user?.email}</div>
            <span className={clsx(
              'inline-block mt-1 text-xs px-1.5 py-0.5 rounded',
              user?.role === 'admin'
                ? 'bg-info-dim text-info'
                : 'bg-surface3 text-tertiary'
            )}>
              {user?.role}
            </span>
          </div>
        )}

        {/* Toggle collapse */}
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg
                     text-tertiary hover:text-primary hover:bg-surface3
                     transition-all duration-150 text-xs"
        >
          <ChevronRight size={14} className={clsx(
            'transition-transform duration-200',
            !collapsed && 'rotate-180'
          )} />
          {!collapsed && 'Réduire'}
        </button>

        {/* Toggle thème */}
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg
                     text-secondary hover:text-primary hover:bg-surface3
                     transition-all duration-150 text-sm"
          title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
        >
          {theme === 'dark'
            ? <Sun  size={14} className="shrink-0 text-warning" />
            : <Moon size={14} className="shrink-0 text-info" />}
          {!collapsed && (
            <span>{theme === 'dark' ? 'Mode clair' : 'Mode sombre'}</span>
          )}
        </button>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg
                     text-danger/70 hover:text-danger hover:bg-danger-dim
                     transition-all duration-150 text-sm"
          title={collapsed ? 'Déconnexion' : undefined}
        >
          <LogOut size={14} className="shrink-0" />
          {!collapsed && 'Déconnexion'}
        </button>
      </div>
    </aside>
  );
}
