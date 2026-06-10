// src/pages/LoginPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate }         from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, AlertCircle, Wifi } from 'lucide-react';
import useAuthStore from '@/store/authStore';
import { login }   from '@/api/auth';
import toast       from 'react-hot-toast';

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth, isAuth } = useAuthStore();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [mounted,  setMounted]  = useState(false);

  useEffect(() => {
    if (isAuth) navigate('/dashboard', { replace: true });
    setTimeout(() => setMounted(true), 50);
  }, [isAuth, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Veuillez remplir tous les champs.'); return; }
    setError('');
    setLoading(true);
    try {
      const { data } = await login(email.trim(), password);
      setAuth({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
      toast.success(`Bienvenue, ${data.user.prenom} !`);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur de connexion';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4 relative overflow-hidden">

      {/* ── Fond animé ───────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Grille subtile */}
        <div className="absolute inset-0"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px)',
            backgroundSize: '48px 48px'
          }}
        />
        {/* Halos lumineux */}
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full"
          style={{ background: 'radial-gradient(circle,rgba(29,78,216,.08) 0%,transparent 70%)' }}
        />
        <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle,rgba(16,185,129,.06) 0%,transparent 70%)' }}
        />
      </div>

      {/* ── Card login ───────────────────────────────────── */}
      <div
        className="relative w-full max-w-md"
        style={{
          opacity   : mounted ? 1 : 0,
          transform : mounted ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity .4s ease, transform .4s ease',
        }}
      >
        {/* Logo + Titre */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface border border-border2 mb-4 shadow-glow">
            <div className="flex flex-col gap-0.5">
              <div className="flex gap-0.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-brand" />
                <div className="w-2.5 h-2.5 rounded-sm bg-brand-l opacity-60" />
              </div>
              <div className="flex gap-0.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-brand opacity-40" />
                <div className="w-2.5 h-2.5 rounded-sm bg-success" />
              </div>
            </div>
          </div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">
            ClicToPay
            <span className="text-brand ml-2 font-light">Monitoring</span>
          </h1>
          <p className="text-tertiary text-sm mt-1">Plateforme interne · Monetique Tunisie</p>
        </div>

        {/* Formulaire */}
        <div className="card-lg p-8" style={{ boxShadow: '0 24px 64px rgba(0,0,0,.5)' }}>
          <h2 className="text-lg font-semibold text-primary mb-6">Connexion</h2>

          {/* Erreur */}
          {error && (
            <div className="flex items-start gap-2.5 bg-danger-dim border border-danger/20
                            rounded-lg px-4 py-3 mb-5 text-sm text-danger animate-fade-in">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                Adresse e-mail
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@clictopay.com"
                  className="input pl-9"
                  autoComplete="email"
                  autoFocus
                  disabled={loading}
                />
              </div>
            </div>

            {/* Mot de passe */}
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                Mot de passe
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input pl-9 pr-10"
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-tertiary
                             hover:text-secondary transition-colors"
                >
                  {showPwd ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>
            </div>

            {/* Bouton */}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-2.5 mt-2
                         relative overflow-hidden"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10"
                      stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Connexion en cours…
                </>
              ) : (
                'Se connecter'
              )}
            </button>
          </form>

          {/* Séparateur */}
          <div className="sep" />

          {/* Indicateur API */}
          <ApiStatus />
        </div>

        {/* Footer */}
        <p className="text-center text-tertiary text-xs mt-6">
          SMT COCKPIT v2.0 · Accès réservé aux opérateurs autorisés
        </p>
      </div>
    </div>
  );
}

/* ── Indicateur statut API ─────────────────────────────── */
function ApiStatus() {
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(d => setStatus(d.status === 'ok' ? 'ok' : 'error'))
      .catch(() => setStatus('error'));
  }, []);

  const map = {
    checking: { color: 'text-warning', dot: 'bg-warning', label: 'Vérification…' },
    ok      : { color: 'text-success', dot: 'bg-success animate-pulse', label: 'API connectée' },
    error   : { color: 'text-danger',  dot: 'bg-danger',  label: 'API inaccessible' },
  };
  const s = map[status];

  return (
    <div className={`flex items-center gap-2 text-xs ${s.color}`}>
      <Wifi size={12} />
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <span>{s.label}</span>
    </div>
  );
}
