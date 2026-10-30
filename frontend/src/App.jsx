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
import BanquesDashboardPage from '@/pages/BanquesDashboardPage';
import PsmFacturationPage from '@/pages/PsmFacturationPage';
import BaselinePage from '@/pages/BaselinePage';
import UsersPage from '@/pages/UsersPage';
import StrategiePage from '@/pages/StrategiePage';
import VersionPage from '@/pages/VersionPage';
import FacturationPage from '@/pages/FacturationPage';
import ReconciliationPage from '@/pages/ReconciliationPage';
import RapportsPage      from '@/pages/RapportsPage';
import InscriptionsPage  from '@/pages/InscriptionsPage';
import useThemeStore     from '@/store/themeStore';

export default function App() {
  const initTheme = useThemeStore(s => s.initTheme);
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
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard"    element={<ProtectedRoute roles={['admin','supervisor','operateur']}><DashboardPage /></ProtectedRoute>} />
          <Route path="/transactions" element={<ProtectedRoute roles={['admin','supervisor','operateur']}><TransactionsPage /></ProtectedRoute>} />
          <Route path="/paysmart"     element={<ProtectedRoute roles={['admin','supervisor','operateur']}><PaysmartPage /></ProtectedRoute>} />
          <Route path="/acs"          element={<ProtectedRoute roles={['admin','supervisor','operateur']}><AcsPage /></ProtectedRoute>} />
          <Route path="/merchants"    element={<MerchantsPage />} />
          <Route path="/recettes"     element={<PlaceholderPage title="Cahier des Recettes" />} />
          <Route path="/validation"   element={<ValidationPage />} />
          <Route path="/banques-dashboard" element={<ProtectedRoute roles={['admin','supervisor','banquier']}><BanquesDashboardPage /></ProtectedRoute>} />
          <Route path="/psm-facturation" element={<ProtectedRoute><PsmFacturationPage/></ProtectedRoute>}/>
        <Route path="/facturation" element={<ProtectedRoute><FacturationPage/></ProtectedRoute>}/>
        <Route path="/reconciliation" element={<ProtectedRoute><ReconciliationPage/></ProtectedRoute>}/>
        <Route path="/rapports" element={<ProtectedRoute><RapportsPage/></ProtectedRoute>}/>
        <Route path="/inscriptions" element={<ProtectedRoute roles={['admin']}><InscriptionsPage /></ProtectedRoute>} />
          <Route path="/banks"    element={<ProtectedRoute roles={['admin']}><BanksPage /></ProtectedRoute>} />
          <Route path="/alerts"   element={<ProtectedRoute roles={['admin']}><AlertsPage /></ProtectedRoute>} />
          <Route path="/logs"     element={<ProtectedRoute roles={['admin']}><LogsPage /></ProtectedRoute>} />
          <Route path="/strategie/baselines" element={<ProtectedRoute><BaselinePage/></ProtectedRoute>}/>
        <Route path="/users" element={<ProtectedRoute><UsersPage/></ProtectedRoute>}/>
        <Route path="/strategie" element={<ProtectedRoute><StrategiePage/></ProtectedRoute>}/>
        <Route path="/strategie/:axeSlug" element={<ProtectedRoute><StrategiePage/></ProtectedRoute>}/>
        <Route path="/version" element={<ProtectedRoute><VersionPage/></ProtectedRoute>}/>
        <Route path="/settings" element={<ProtectedRoute roles={['admin']}><SettingsPage /></ProtectedRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/merchants" replace />} />
      </Routes>
    </>
  );
}
