// src/App.jsx — Routeur principal
import { useEffect }      from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster }       from 'react-hot-toast';
import ProtectedRoute    from '@/components/auth/ProtectedRoute';
import AppLayout         from '@/components/layout/AppLayout';
import LoginPage         from '@/pages/LoginPage';
import DashboardPage     from '@/pages/DashboardPage';
import TransactionsPage  from '@/pages/TransactionsPage';
import MerchantsPage     from '@/pages/MerchantsPage';
import ValidationPage    from '@/pages/ValidationPage';
import PaysmartPage      from '@/pages/PaysmartPage';
import AcsPage           from '@/pages/AcsPage';
import BanksPage         from '@/pages/BanksPage';
import AlertsPage        from '@/pages/AlertsPage';
import SettingsPage      from '@/pages/SettingsPage';
import LogsPage          from '@/pages/LogsPage';
import PlaceholderPage   from '@/pages/PlaceholderPage';
import useThemeStore     from '@/store/themeStore';

export default function App() {
  const initTheme = useThemeStore(s => s.initTheme);

  // Appliquer le thème sauvegardé au démarrage
  useEffect(() => { initTheme(); }, [initTheme]);
  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: {
            background: '#181d2a',
            color      : '#e8eaf0',
            border     : '1px solid rgba(255,255,255,0.08)',
            fontSize   : '13px',
            borderRadius: '10px',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#181d2a' } },
          error  : { iconTheme: { primary: '#f87171', secondary: '#181d2a' } },
        }}
      />

      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protégées */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index                  element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard"      element={<DashboardPage />} />
          <Route path="/transactions"   element={<TransactionsPage />} />
          <Route path="/paysmart"       element={<PaysmartPage />} />
          <Route path="/acs"            element={<AcsPage />} />
          <Route path="/merchants"      element={<MerchantsPage />} />
          <Route path="/recettes"       element={<PlaceholderPage title="Cahier des Recettes" />} />
          <Route path="/validation"     element={<ValidationPage />} />
          <Route path="/banks"          element={<ProtectedRoute roles={['admin']}><BanksPage/></ProtectedRoute>} />
          <Route path="/alerts"         element={<ProtectedRoute roles={['admin']}><AlertsPage/></ProtectedRoute>} />
          <Route path="/logs"           element={<ProtectedRoute roles={['admin']}><LogsPage/></ProtectedRoute>} />
          <Route path="/settings"       element={<SettingsPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}
