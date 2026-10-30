// src/pages/SettingsPage.jsx
import { useState }           from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { User, Lock, Users, Save, Plus, Eye, EyeOff, Check, X, Pencil, Power, Key, Building2, Sun, Moon, Monitor, Mail, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import toast      from 'react-hot-toast';
import clsx       from 'clsx';
import { SectionHeader, Spinner } from '@/components/ui';
import { getMe, changePassword, getUsers, createUser, updateUser } from '@/api/auth';
import useAuthStore  from '@/store/authStore';
import useThemeStore from '@/store/themeStore';
import ApiTokensTab  from '@/components/settings/ApiTokensTab';
import PayfacsTab    from '@/components/settings/PayfacsTab';
import client        from '@/api/client';

const TABS = [
  { key: 'profile',       label: 'Mon profil',      icon: User      },
  { key: 'password',      label: 'Mot de passe',    icon: Lock      },
  { key: 'users',         label: 'Utilisateurs',    icon: Users,     adminOnly: true },
  { key: 'payfacs',       label: 'PAYFACs',          icon: Building2, adminOnly: true },
  { key: 'api-tokens',    label: 'Tokens API',      icon: Key,       adminOnly: true },
  { key: 'email-preview', label: 'Aperçu Emails',   icon: Mail,      adminOnly: true },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('profile');
  const isAdmin = useAuthStore(s => s.isAdmin());

  return (
    <div className="space-y-4 animate-fade-in">
      <SectionHeader title="Paramètres" sub="Profil · Sécurité · Administration"/>

      {/* Onglets */}
      <div className="flex border-b border-border">
        {TABS.filter(t => (t.key !== 'users' && t.key !== 'api-tokens') || isAdmin).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={clsx('flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key ? 'border-brand text-primary' : 'border-transparent text-tertiary hover:text-secondary')}>
            <tab.icon size={14}/>{tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile'       && <ProfileTab/>}
      {activeTab === 'password'      && <PasswordTab/>}
      {activeTab === 'users'         && isAdmin && <UsersTab/>}
      {activeTab === 'payfacs'       && isAdmin && <PayfacsTab/>}
      {activeTab === 'api-tokens'    && isAdmin && <ApiTokensTab/>}
      {activeTab === 'email-preview' && isAdmin && <EmailPreviewTab/>}
    </div>
  );
}

// ── Onglet Profil ──────────────────────────────────────────
function ProfileTab() {
  const { user, setUser }          = useAuthStore();
  const { theme, setTheme }        = useThemeStore();
  const [form,   setForm]   = useState({ prenom: user?.prenom || '', nom: user?.nom || '', email: user?.email || '' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      setUser({ ...user, prenom: form.prenom, nom: form.nom });
      toast.success('Profil mis à jour');
    } catch(e) {
      toast.error('Erreur mise à jour profil');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg space-y-4">
      {/* Avatar */}
      <div className="card p-6 flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-brand/20 border-2 border-brand/30
                        flex items-center justify-center text-2xl font-bold text-brand">
          {user?.prenom?.[0]}{user?.nom?.[0]}
        </div>
        <div>
          <div className="text-base font-semibold text-primary">{user?.prenom} {user?.nom}</div>
          <div className="text-xs text-tertiary mt-0.5">{user?.email}</div>
          <span className={clsx('badge text-xs mt-1',
            user?.role === 'admin' ? 'badge-info' : 'badge-neutral')}>
            {user?.role}
          </span>
        </div>
      </div>

      {/* Formulaire */}
      <div className="card p-6 space-y-4">
        <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1">
          Informations personnelles
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-tertiary mb-1.5">Prénom</label>
            <input type="text" value={form.prenom} onChange={e => setForm(p => ({...p, prenom: e.target.value}))}
              className="input"/>
          </div>
          <div>
            <label className="block text-xs text-tertiary mb-1.5">Nom</label>
            <input type="text" value={form.nom} onChange={e => setForm(p => ({...p, nom: e.target.value}))}
              className="input"/>
          </div>
        </div>
        <div>
          <label className="block text-xs text-tertiary mb-1.5">Email</label>
          <input type="email" value={form.email} disabled className="input opacity-50 cursor-not-allowed"/>
          <div className="text-xs text-tertiary mt-1">L'email ne peut pas être modifié.</div>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm">
            {saving ? <Spinner size={13}/> : <Save size={13}/>}
            Enregistrer
          </button>
        </div>
      </div>

      {/* ── Apparence ───────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <div className="text-xs font-semibold text-secondary uppercase tracking-wide">
          Apparence
        </div>
        <p className="text-xs text-tertiary -mt-1">
          Choisissez le mode d'affichage. La préférence est sauvegardée localement.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            {
              key  : 'dark',
              label: 'Mode sombre',
              icon : Moon,
              desc : 'Fond noir — recommandé la nuit',
              preview: 'bg-gray-900 border-gray-700',
              dot1: 'bg-gray-700', dot2: 'bg-gray-600', dot3: 'bg-blue-500',
            },
            {
              key  : 'light',
              label: 'Mode clair',
              icon : Sun,
              desc : 'Fond blanc — lumineux',
              preview: 'bg-gray-100 border-gray-300',
              dot1: 'bg-gray-200', dot2: 'bg-gray-300', dot3: 'bg-blue-500',
            },
          ].map(opt => (
            <button
              key={opt.key}
              onClick={() => {
                setTheme(opt.key);
                toast.success(`${opt.label} activé`);
              }}
              className={clsx(
                'relative flex flex-col gap-3 p-4 rounded-xl border-2 text-left transition-all duration-150',
                theme === opt.key
                  ? 'border-brand bg-brand/5'
                  : 'border-border bg-surface2 hover:border-brand/40 hover:bg-surface3'
              )}
            >
              {/* Mini aperçu */}
              <div className={clsx('w-full h-10 rounded-lg border flex items-center gap-1.5 px-2 overflow-hidden', opt.preview)}>
                <div className={clsx('w-4 h-full rounded-sm', opt.dot1)} />
                <div className="flex-1 space-y-1">
                  <div className={clsx('h-1.5 rounded-full w-3/4', opt.dot2)} />
                  <div className={clsx('h-1.5 rounded-full w-1/2', opt.dot2)} />
                </div>
                <div className={clsx('w-4 h-3 rounded', opt.dot3)} />
              </div>

              {/* Label */}
              <div className="flex items-center gap-2">
                <opt.icon size={14} className={theme === opt.key ? 'text-brand' : 'text-tertiary'}/>
                <div>
                  <div className={clsx('text-sm font-semibold', theme === opt.key ? 'text-brand' : 'text-primary')}>
                    {opt.label}
                  </div>
                  <div className="text-xs text-tertiary">{opt.desc}</div>
                </div>
              </div>

              {/* Badge actif */}
              {theme === opt.key && (
                <span className="absolute top-2 right-2 text-xs bg-brand text-white
                                 px-1.5 py-0.5 rounded-full font-medium">
                  Actif
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Info session */}
      <div className="card p-4 text-xs text-tertiary space-y-1">
        <div className="font-semibold text-secondary mb-2">Informations de session</div>
        <div className="flex justify-between">
          <span>Rôle</span>
          <span className="text-primary font-medium">{user?.role}</span>
        </div>
        <div className="flex justify-between">
          <span>ID utilisateur</span>
          <span className="font-mono text-tertiary">{user?.id?.slice(0, 8)}…</span>
        </div>
        <div className="flex justify-between">
          <span>Thème actuel</span>
          <span className="text-primary font-medium capitalize">{theme === 'dark' ? 'Sombre' : 'Clair'}</span>
        </div>
      </div>
    </div>
  );
}

// ── Onglet Mot de passe ────────────────────────────────────
function PasswordTab() {
  const [form,   setForm]   = useState({ current: '', newPwd: '', confirm: '' });
  const [show,   setShow]   = useState({ current: false, newPwd: false, confirm: false });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const toggle = (field) => setShow(p => ({ ...p, [field]: !p[field] }));

  const validate = () => {
    const e = {};
    if (!form.current) e.current = 'Mot de passe actuel requis';
    if (!form.newPwd)  e.newPwd  = 'Nouveau mot de passe requis';
    else if (form.newPwd.length < 8) e.newPwd = 'Minimum 8 caractères';
    else if (!/(?=.*[A-Z])(?=.*[0-9])/.test(form.newPwd))
      e.newPwd = 'Doit contenir au moins 1 majuscule et 1 chiffre';
    if (form.newPwd !== form.confirm) e.confirm = 'Les mots de passe ne correspondent pas';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await changePassword(form.current, form.newPwd);
      toast.success('Mot de passe modifié avec succès');
      setForm({ current:'', newPwd:'', confirm:'' });
      setErrors({});
    } catch(e) {
      toast.error(e.response?.data?.error || 'Mot de passe actuel incorrect');
    } finally {
      setSaving(false);
    }
  };

  // Indicateur de force
  const strength = (() => {
    const p = form.newPwd;
    if (!p) return 0;
    let s = 0;
    if (p.length >= 8)                     s++;
    if (p.length >= 12)                    s++;
    if (/[A-Z]/.test(p))                   s++;
    if (/[0-9]/.test(p))                   s++;
    if (/[^A-Za-z0-9]/.test(p))            s++;
    return s;
  })();

  const strengthCfg = [
    null,
    { label: 'Très faible', color: 'bg-danger',  w: 'w-1/5' },
    { label: 'Faible',      color: 'bg-danger',  w: 'w-2/5' },
    { label: 'Moyen',       color: 'bg-warning', w: 'w-3/5' },
    { label: 'Fort',        color: 'bg-success', w: 'w-4/5' },
    { label: 'Très fort',   color: 'bg-success', w: 'w-full' },
  ];

  return (
    <div className="max-w-md space-y-4">
      <div className="card p-6 space-y-4">
        <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1">
          Changer le mot de passe
        </div>

        {[
          { field:'current', label:'Mot de passe actuel' },
          { field:'newPwd',  label:'Nouveau mot de passe' },
          { field:'confirm', label:'Confirmer le nouveau mot de passe' },
        ].map(({ field, label }) => (
          <div key={field}>
            <label className="block text-xs text-tertiary mb-1.5">{label}</label>
            <div className="relative">
              <input
                type={show[field] ? 'text' : 'password'}
                value={form[field]}
                onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
                className={clsx('input pr-10', errors[field] && 'border-danger')}
              />
              <button type="button" onClick={() => toggle(field)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-tertiary hover:text-secondary">
                {show[field] ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            </div>
            {errors[field] && <div className="text-xs text-danger mt-1">{errors[field]}</div>}

            {/* Indicateur de force pour le nouveau mot de passe */}
            {field === 'newPwd' && form.newPwd && (
              <div className="mt-2">
                <div className="h-1 bg-surface3 rounded-full overflow-hidden">
                  <div className={clsx('h-full rounded-full transition-all duration-300',
                    strengthCfg[strength]?.color, strengthCfg[strength]?.w)}/>
                </div>
                <div className="text-xs text-tertiary mt-1">{strengthCfg[strength]?.label}</div>
              </div>
            )}
          </div>
        ))}

        {/* Règles */}
        <div className="bg-surface2 rounded-lg p-3 space-y-1">
          {[
            { ok: form.newPwd.length >= 8,              label: 'Au moins 8 caractères' },
            { ok: /[A-Z]/.test(form.newPwd),            label: 'Au moins 1 majuscule'  },
            { ok: /[0-9]/.test(form.newPwd),            label: 'Au moins 1 chiffre'    },
            { ok: /[^A-Za-z0-9]/.test(form.newPwd),     label: 'Caractère spécial recommandé' },
          ].map(({ ok, label }) => (
            <div key={label} className={clsx('flex items-center gap-2 text-xs', ok ? 'text-success' : 'text-tertiary')}>
              {ok ? <Check size={11}/> : <X size={11}/>}
              {label}
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm">
            {saving ? <Spinner size={13}/> : <Lock size={13}/>}
            Changer le mot de passe
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Générateur de mot de passe temporaire ─────────────────
function genTempPassword() {
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower  = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const spec   = '@#$!';
  const all    = upper + lower + digits + spec;
  let pwd = upper[Math.floor(Math.random() * upper.length)]
          + digits[Math.floor(Math.random() * digits.length)]
          + spec[Math.floor(Math.random() * spec.length)];
  for (let i = 0; i < 5; i++) pwd += all[Math.floor(Math.random() * all.length)];
  return pwd.split('').sort(() => Math.random() - 0.5).join('');
}

// ── Onglet Utilisateurs (admin) ────────────────────────────
function UsersTab() {
  const qc = useQueryClient();
  const [modal,  setModal]  = useState(null);
  const [form,   setForm]   = useState({ prenom:'', nom:'', email:'', role:'operateur', bank_code:'' });
  const [saving, setSaving] = useState(false);
  const [showPwd,setShowPwd]= useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn : () => getUsers().then(r => r.data.users || []),
    staleTime: 30_000,
  });

  const openAdd = () => {
    setForm({ prenom:'', nom:'', email:'', role:'operateur' });
    setModal({ mode:'add' });
  };

  const openEdit = (u) => {
    setForm({ prenom: u.prenom, nom: u.nom, email: u.email, role: u.role, bank_code: u.bank_code || '' });
    setModal({ mode:'edit', user: u });
  };

  const handleSave = async () => {
    if (!form.email || !form.prenom || !form.nom) {
      toast.error('Prénom, nom et email requis');
      return;
    }
    if (form.role === 'banquier' && !form.bank_code.trim()) {
      toast.error('Code banque obligatoire pour le rôle Banquier (2 chiffres)');
      return;
    }
    setSaving(true);
    try {
      if (modal.mode === 'add') {
        // Générer un mot de passe temporaire côté client
        const tempPassword = genTempPassword();
        const { data } = await createUser({
          prenom    : form.prenom,
          nom       : form.nom,
          email     : form.email,
          password  : tempPassword,
          role      : form.role,
          bank_code : form.role === 'banquier' ? (form.bank_code || null) : null,
          permissions: form.role === 'banquier' ? { can_upload_cahier: false, can_validate: false, can_action: false } : {},
        });
        // Afficher le mot de passe temporaire dans un toast persistant
        toast.success(
          `✅ Utilisateur créé !\nEmail : ${form.email}\nMot de passe : ${tempPassword}`,
          { duration: 15000 }
        );
        // Copier dans le presse-papier
        navigator.clipboard?.writeText(tempPassword).catch(() => {});
      } else {
        await updateUser(modal.user.id, { prenom: form.prenom, nom: form.nom, role: form.role, bank_code: form.role === 'banquier' ? (form.bank_code || null) : null });
        toast.success('Utilisateur mis à jour');
      }
      qc.invalidateQueries({ queryKey: ['users'] });
      setModal(null);
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur création utilisateur');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (u) => {
    try {
      await updateUser(u.id, { actif: !u.actif });
      toast.success(u.actif ? `${u.email} désactivé` : `${u.email} réactivé`);
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-tertiary">{users.length} utilisateur(s)</div>
        <button onClick={openAdd} className="btn-primary btn-sm">
          <Plus size={13}/> Nouvel utilisateur
        </button>
      </div>

      {isLoading ? (
        <div className="card p-8 flex justify-center"><Spinner size={24}/></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Email</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th>Dernière connexion</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className={clsx(!u.actif && 'opacity-50')}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-brand/20 border border-brand/30
                                      flex items-center justify-center text-xs font-semibold text-brand">
                        {u.prenom?.[0]}{u.nom?.[0]}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-primary">{u.prenom} {u.nom}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-xs font-mono text-secondary">{u.email}</td>
                  <td>
                    <span className={clsx('badge text-xs',
                      u.role === 'admin' ? 'badge-info' :
                      u.role === 'banquier' ? 'badge-warning' : 'badge-neutral')}>
                      {u.role}
                    </span>
                    {u.bank_code && (
                      <span className="ml-1 badge badge-neutral text-xs font-mono">{u.bank_code}</span>
                    )}
                  </td>
                  <td>
                    <span className={clsx('badge text-xs', u.actif ? 'badge-success' : 'badge-neutral')}>
                      {u.actif ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="text-xs text-tertiary">
                    {u.last_login
                      ? new Date(u.last_login).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
                      : 'Jamais'}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(u)} className="btn-ghost btn-sm" title="Modifier">
                        <Pencil size={12}/>
                      </button>
                      <button
                        onClick={() => handleToggle(u)}
                        className={clsx('btn-sm', u.actif ? 'btn-ghost text-danger/70 hover:text-danger' : 'btn-ghost text-success/70 hover:text-success')}
                        title={u.actif ? 'Désactiver' : 'Réactiver'}
                      >
                        <Power size={12}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
             onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="bg-surface border border-border2 rounded-xl w-full max-w-md shadow-2xl animate-slide-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="text-sm font-semibold text-primary">
                {modal.mode === 'add' ? '+ Nouvel utilisateur' : `Modifier — ${modal.user.email}`}
              </div>
              <button onClick={() => setModal(null)} className="text-tertiary hover:text-primary"><X size={16}/></button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-tertiary mb-1">Prénom *</label>
                  <input type="text" value={form.prenom} onChange={e => setForm(p => ({...p, prenom: e.target.value}))} className="input"/>
                </div>
                <div>
                  <label className="block text-xs text-tertiary mb-1">Nom *</label>
                  <input type="text" value={form.nom} onChange={e => setForm(p => ({...p, nom: e.target.value}))} className="input"/>
                </div>
              </div>
              <div>
                <label className="block text-xs text-tertiary mb-1">Email *</label>
                <input type="email" value={form.email}
                  onChange={e => setForm(p => ({...p, email: e.target.value}))}
                  disabled={modal.mode === 'edit'}
                  className={clsx('input', modal.mode === 'edit' && 'opacity-50 cursor-not-allowed')}/>
              </div>
              <div>
                <label className="block text-xs text-tertiary mb-1">Rôle</label>
                <select value={form.role} onChange={e => setForm(p => ({...p, role: e.target.value}))} className="input">
                  <option value="operateur">Opérateur</option>
                  <option value="supervisor">Superviseur</option>
                  <option value="admin">Administrateur</option>
                  <option value="banquier">Banquier</option>
                </select>
              </div>
              {form.role === 'banquier' && (
                <div>
                  <label className="block text-xs text-tertiary mb-1">Code banque * <span className="text-tertiary font-normal">(2 premiers chiffres du processing_id)</span></label>
                  <input type="text" maxLength={2} value={form.bank_code}
                    onChange={e => setForm(p => ({...p, bank_code: e.target.value.replace(/[^0-9]/g,'').slice(0,2)}))}
                    placeholder="ex: 08"
                    className="input font-mono w-24"/>
                  <div className="text-xs text-tertiary mt-1">Le banquier ne verra que les marchands de cette banque.</div>
                </div>
              )}
              {modal.mode === 'add' && (
                <div className="text-xs text-info bg-info-dim border border-info/20 rounded-lg px-3 py-2.5">
                  ℹ️ Un mot de passe temporaire sera généré automatiquement et affiché après la création. Il sera aussi copié dans le presse-papier.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
              <button onClick={() => setModal(null)} className="btn-ghost btn-sm">Annuler</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm">
                {saving ? <Spinner size={13}/> : <Save size={13}/>}
                {saving ? 'Sauvegarde…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// EmailPreviewTab — Envoi d'échantillons pour vérification
// ══════════════════════════════════════════════════════════
const DEFAULT_TO  = 'Wissem.baghdadi@monetiquetunisie.com';
const DEFAULT_PID = '0870713013';

const EMAIL_LABELS = {
  bienvenue_test    : { icon: '1', label: 'Bienvenue — Paramètres TEST',         color: 'text-info'    },
  renvoi_cahier     : { icon: '2', label: 'Rappel — Cahier de recettes',          color: 'text-warning' },
  notif_banque      : { icon: '3', label: 'Demande passage production (banque)',  color: 'text-secondary'},
  prod_credentials  : { icon: '4', label: 'Credentials PRODUCTION',               color: 'text-success' },
  force_prod_banque : { icon: '5', label: 'F.PROD — Sous-marchand PAYFAC',        color: 'text-brand'   },
  alerte_sla        : { icon: '6', label: 'Alerte SLA (dossier en retard)',        color: 'text-danger'  },
};

function EmailPreviewTab() {
  const [to,        setTo]        = useState(DEFAULT_TO);
  const [pid,       setPid]       = useState(DEFAULT_PID);
  const [sending,   setSending]   = useState(false);
  const [result,    setResult]    = useState(null);
  const [merchant,  setMerchant]  = useState(null);
  const [loadingMch,setLoadingMch]= useState(false);
  const [pidError,  setPidError]  = useState('');

  // Charger les infos du marchand quand le PID change
  const loadMerchant = async (p) => {
    if (!p || p.length < 5) { setMerchant(null); setPidError(''); return; }
    setLoadingMch(true);
    setPidError('');
    try {
      const { data } = await client.get(`/email-preview/merchant/${p}`);
      setMerchant(data.merchant);
    } catch(e) {
      setMerchant(null);
      setPidError(e.response?.status === 404
        ? `Marchand "${p}" introuvable dans la base locale`
        : 'Erreur de chargement');
    } finally {
      setLoadingMch(false);
    }
  };

  // Chargement initial
  useState(() => { loadMerchant(DEFAULT_PID); }, []);

  const handlePidChange = (v) => {
    setPid(v);
    setResult(null);
    if (v.length >= 5) loadMerchant(v);
    else { setMerchant(null); setPidError(''); }
  };

  const handleSend = async () => {
    if (!to.trim())  { toast.error('Email destinataire requis');    return; }
    if (!pid.trim()) { toast.error('Processing ID requis');          return; }
    if (pidError)    { toast.error('Corrigez le Processing ID');     return; }

    setSending(true);
    setResult(null);
    try {
      const { data } = await client.post('/email-preview/send', {
        to : to.trim(),
        processing_id: pid.trim(),
      });
      setResult(data);
      if (data.success) {
        toast.success(`✅ ${data.emails_sent} email(s) envoyés → ${to}`);
      } else {
        toast.error(`${data.emails_sent} envoyés — ${data.errors?.length || 0} erreur(s)`);
      }
    } catch(e) {
      toast.error(e.response?.data?.error || 'Erreur envoi');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">

      {/* Description */}
      <div className="card p-4 border-l-2 border-brand bg-brand/5">
        <div className="text-sm font-semibold text-primary mb-1">Aperçu & Vérification des templates email</div>
        <div className="text-xs text-secondary leading-relaxed">
          Envoie les 6 templates de communication à l'adresse indiquée, pré-remplis avec les données
          réelles du marchand sélectionné. Permet de vérifier le contenu, le rendu et les informations
          avant déploiement.
        </div>
      </div>

      {/* Configuration */}
      <div className="card p-5 space-y-4">
        <div className="text-xs font-semibold text-secondary uppercase tracking-wide">Configuration</div>

        {/* Destinataire */}
        <div>
          <label className="block text-xs text-tertiary mb-1.5">Adresse email destinataire *</label>
          <input
            type="email"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="input w-full"
            placeholder="email@monetiquetunisie.com"
          />
          <div className="text-xs text-tertiary mt-1">
            Par défaut : {DEFAULT_TO}
          </div>
        </div>

        {/* Marchand de démonstration */}
        <div>
          <label className="block text-xs text-tertiary mb-1.5">Processing ID du marchand exemple *</label>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={pid}
              onChange={e => handlePidChange(e.target.value)}
              className={clsx('input flex-1', pidError && 'border-danger')}
              placeholder="0870713013"
            />
            {loadingMch && <Loader2 size={16} className="animate-spin text-tertiary shrink-0"/>}
            {merchant && !loadingMch && <CheckCircle2 size={16} className="text-success shrink-0"/>}
            {pidError  && !loadingMch && <AlertCircle  size={16} className="text-danger shrink-0"/>}
          </div>
          {pidError && <div className="text-xs text-danger mt-1">{pidError}</div>}
          {merchant && (
            <div className="mt-2 px-3 py-2 bg-surface2 rounded-lg border border-border text-xs">
              <div className="font-semibold text-primary">{merchant.raison_sociale}</div>
              <div className="text-tertiary mt-0.5 flex flex-wrap gap-3">
                <span>Statut : <span className="text-secondary">{merchant.statut}</span></span>
                {merchant.terminal_id && <span>Terminal : <span className="font-mono text-secondary">{merchant.terminal_id}</span></span>}
                {(merchant.site_url || merchant.site_web) && (
                  <span>Site : <span className="text-info">{merchant.site_url || merchant.site_web}</span></span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Emails qui seront envoyés */}
      <div className="card p-5">
        <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">
          Emails qui seront envoyés ({Object.keys(EMAIL_LABELS).length})
        </div>
        <div className="space-y-2">
          {Object.entries(EMAIL_LABELS).map(([key, cfg]) => {
            const sentItem = result?.emails?.find(e => e.key === key);
            return (
              <div key={key} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                <div className="w-6 h-6 rounded-full bg-surface3 flex items-center justify-center shrink-0">
                  <span className="text-xs font-mono text-tertiary">{cfg.icon}</span>
                </div>
                <div className={clsx('text-xs flex-1', cfg.color)}>{cfg.label}</div>
                {sentItem && (
                  <span className={clsx('text-xs font-medium',
                    sentItem.status === 'sent' ? 'text-success' : 'text-danger')}>
                    {sentItem.status === 'sent' ? '✓ Envoyé' : '✗ Erreur'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bouton envoi */}
      <button
        onClick={handleSend}
        disabled={sending || !!pidError || !merchant}
        className="btn-primary w-full py-3 text-sm font-semibold flex items-center justify-center gap-2"
      >
        {sending ? (
          <><Loader2 size={16} className="animate-spin"/> Envoi en cours…</>
        ) : (
          <><Mail size={16}/> Envoyer les 6 emails à {to}</>
        )}
      </button>

      {/* Résultat */}
      {result && (
        <div className={clsx('card p-4 border-l-2', result.success ? 'border-success bg-success/5' : 'border-warning bg-warning/5')}>
          <div className="text-sm font-semibold text-primary mb-2">
            {result.success ? '✅ Tous les emails envoyés' : '⚠️ Envoi partiel'}
          </div>
          <div className="text-xs text-secondary mb-2">
            {result.emails_sent}/{Object.keys(EMAIL_LABELS).length} emails envoyés → <span className="font-mono">{result.sent_to}</span>
          </div>
          {result.errors?.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.errors.map((e, i) => (
                <div key={i} className="text-xs text-danger">
                  ✗ {EMAIL_LABELS[e.key]?.label || e.key} : {e.error}
                </div>
              ))}
            </div>
          )}
          <div className="text-xs text-tertiary mt-2">
            Vérifiez votre boîte mail — les 6 emails ont été envoyés séparément pour faciliter la relecture.
          </div>
        </div>
      )}
    </div>
  );
}
