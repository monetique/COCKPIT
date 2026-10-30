// src/pages/UsersPage.jsx — Gestion des utilisateurs
import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import client from '@/api/client';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Users, Plus, Edit2, UserX, Check, X, ChevronDown } from 'lucide-react';

const ROLES = [
  { value:'admin',         label:'Administrateur',       color:'bg-red-100 text-red-700' },
  { value:'directeur',     label:'Directeur',            color:'bg-purple-100 text-purple-700' },
  { value:'dg',            label:'Direction Générale',   color:'bg-purple-100 text-purple-700' },
  { value:'pilotage',      label:'Cellule pilotage',     color:'bg-blue-100 text-blue-700' },
  { value:'chef_division', label:'Chef de division',     color:'bg-cyan-100 text-cyan-700' },
  { value:'operateur',     label:'Opérateur',            color:'bg-green-100 text-green-700' },
  { value:'supervisor',    label:'Superviseur',          color:'bg-green-100 text-green-700' },
  { value:'lecteur',       label:'Lecteur',              color:'bg-gray-100 text-gray-700' },
  { value:'banquier',      label:'Banquier',             color:'bg-amber-100 text-amber-700' },
];

const DIVISIONS = [
  { value:'systemes', label:'Division Systèmes' },
  { value:'canaux',   label:'Division des Canaux' },
];

const AXES = [
  { num:1, label:'Switch national' },
  { num:2, label:'TUNPAY' },
  { num:3, label:'ClicToPay' },
  { num:4, label:'Data & Fraude' },
  { num:5, label:'Open Banking' },
  { num:6, label:'Paysmart' },
  { num:7, label:'Programmes' },
  { num:8, label:'Transverse' },
];

function RoleBadge({ role }) {
  const cfg = ROLES.find(r => r.value === role);
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
      cfg?.color || 'bg-gray-100 text-gray-600')}>
      {cfg?.label || role}
    </span>
  );
}

const EMPTY_FORM = {
  nom:'', prenom:'', email:'', password:'', role:'operateur',
  division:'', axes_autorises:[], bank_code:'', actif:true,
};

export default function UsersPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm]   = useState(false);
  const [editUser, setEditUser]   = useState(null);
  const [form,     setForm]       = useState(EMPTY_FORM);
  const [filterRole, setFilterRole] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn : () => client.get('/users').then(r => r.data),
  });

  const mutCreate = useMutation({
    mutationFn: (body) => client.post('/users', body),
    onSuccess : () => { toast.success('Utilisateur créé'); qc.invalidateQueries(['users']); closeForm(); },
    onError   : (e) => toast.error(e.response?.data?.error || 'Erreur'),
  });

  const mutUpdate = useMutation({
    mutationFn: ({ id, ...body }) => client.patch(`/users/${id}`, body),
    onSuccess : () => { toast.success('Utilisateur mis à jour'); qc.invalidateQueries(['users']); closeForm(); },
    onError   : (e) => toast.error(e.response?.data?.error || 'Erreur'),
  });

  const mutDelete = useMutation({
    mutationFn: (id) => client.delete(`/users/${id}`),
    onSuccess : () => { toast.success('Utilisateur désactivé'); qc.invalidateQueries(['users']); },
    onError   : (e) => toast.error(e.response?.data?.error || 'Erreur'),
  });

  const closeForm = () => { setShowForm(false); setEditUser(null); setForm(EMPTY_FORM); };

  const openEdit = (u) => {
    setEditUser(u);
    setForm({
      nom: u.nom, prenom: u.prenom, email: u.email, password:'',
      role: u.role, division: u.division||'',
      axes_autorises: u.axes_autorises || [],
      bank_code: u.bank_code||'', actif: u.actif,
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    const body = { ...form };
    if (!body.password) delete body.password;
    if (!body.division) body.division = null;
    if (!body.bank_code) body.bank_code = null;
    if (body.axes_autorises?.length === 0) body.axes_autorises = null;
    if (editUser) mutUpdate.mutate({ id: editUser.id, ...body });
    else          mutCreate.mutate(body);
  };

  const toggleAxe = (num) => {
    const axes = form.axes_autorises || [];
    setForm(f => ({
      ...f,
      axes_autorises: axes.includes(num) ? axes.filter(a => a !== num) : [...axes, num]
    }));
  };

  const users = (data?.users || []).filter(u =>
    !filterRole || u.role === filterRole
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-primary flex items-center gap-2">
            <Users size={18}/> Utilisateurs
          </h1>
          <p className="text-xs text-tertiary mt-0.5">
            Gestion des accès et des droits — {data?.users?.length || 0} utilisateurs
          </p>
        </div>
        <button onClick={() => { setEditUser(null); setForm(EMPTY_FORM); setShowForm(true); }}
          className="btn-primary flex items-center gap-2">
          <Plus size={14}/> Nouvel utilisateur
        </button>
      </div>

      {/* Filtre rôle */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-secondary">Filtrer :</span>
        {['', ...ROLES.map(r => r.value)].map(r => (
          <button key={r} onClick={() => setFilterRole(r)}
            className={clsx('text-xs px-2.5 py-1 rounded-full border transition-colors',
              filterRole === r
                ? 'bg-primary text-white border-primary'
                : 'border-border text-secondary hover:border-primary')}>
            {r ? ROLES.find(x => x.value === r)?.label : 'Tous'}
          </button>
        ))}
      </div>

      {/* Formulaire création / édition */}
      {showForm && (
        <div className="card p-5 border-l-4 border-primary space-y-4">
          <div className="text-sm font-semibold text-primary">
            {editUser ? `Modifier — ${editUser.prenom} ${editUser.nom}` : 'Nouvel utilisateur'}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-secondary mb-1">Prénom *</label>
              <input value={form.prenom} onChange={e => setForm(f=>({...f,prenom:e.target.value}))}
                className="input-field text-sm w-full"/>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Nom *</label>
              <input value={form.nom} onChange={e => setForm(f=>({...f,nom:e.target.value}))}
                className="input-field text-sm w-full"/>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Email *</label>
              <input type="email" value={form.email}
                onChange={e => setForm(f=>({...f,email:e.target.value}))}
                className="input-field text-sm w-full"/>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">
                {editUser ? 'Nouveau mot de passe (laisser vide = inchangé)' : 'Mot de passe *'}
              </label>
              <input type="password" value={form.password}
                onChange={e => setForm(f=>({...f,password:e.target.value}))}
                className="input-field text-sm w-full"/>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Rôle *</label>
              <select value={form.role} onChange={e => setForm(f=>({...f,role:e.target.value}))}
                className="input-field text-sm w-full">
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Division</label>
              <select value={form.division} onChange={e => setForm(f=>({...f,division:e.target.value}))}
                className="input-field text-sm w-full">
                <option value="">— Aucune —</option>
                {DIVISIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            {form.role === 'banquier' && (
              <div>
                <label className="block text-xs text-secondary mb-1">Code banque</label>
                <input value={form.bank_code}
                  onChange={e => setForm(f=>({...f,bank_code:e.target.value}))}
                  className="input-field text-sm w-full" placeholder="ex: 10"/>
              </div>
            )}
            {editUser && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-secondary">Compte actif</label>
                <input type="checkbox" checked={form.actif}
                  onChange={e => setForm(f=>({...f,actif:e.target.checked}))}
                  className="w-4 h-4"/>
              </div>
            )}
          </div>

          {/* Axes autorisés — uniquement pour chef_division */}
          {form.role === 'chef_division' && (
            <div>
              <label className="block text-xs text-secondary mb-2 font-medium">
                Axes stratégiques autorisés
              </label>
              <div className="flex flex-wrap gap-2">
                {AXES.map(a => (
                  <button key={a.num} onClick={() => toggleAxe(a.num)}
                    className={clsx('text-xs px-2.5 py-1 rounded-full border transition-colors',
                      (form.axes_autorises||[]).includes(a.num)
                        ? 'bg-primary text-white border-primary'
                        : 'border-border text-secondary hover:border-primary')}>
                    Axe {a.num} — {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={handleSubmit}
              disabled={mutCreate.isPending || mutUpdate.isPending}
              className="btn-primary flex items-center gap-1.5">
              <Check size={13}/>
              {editUser ? 'Mettre à jour' : 'Créer'}
            </button>
            <button onClick={closeForm} className="btn-ghost">
              <X size={13}/>
            </button>
          </div>
        </div>
      )}

      {/* Tableau utilisateurs */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-24 text-secondary text-sm gap-2">
            <Users size={14} className="animate-pulse"/> Chargement…
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Email</th>
                <th className="text-center">Rôle</th>
                <th className="text-center">Division</th>
                <th className="text-center">Axes</th>
                <th className="text-center">Statut</th>
                <th className="text-center">Dernière connexion</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className={clsx(!u.actif && 'opacity-50')}>
                  <td className="font-medium">{u.prenom} {u.nom}</td>
                  <td className="text-xs text-secondary">{u.email}</td>
                  <td className="text-center"><RoleBadge role={u.role}/></td>
                  <td className="text-center text-xs text-secondary">
                    {u.division
                      ? DIVISIONS.find(d=>d.value===u.division)?.label || u.division
                      : '—'}
                  </td>
                  <td className="text-center">
                    {u.axes_autorises?.length > 0 ? (
                      <div className="flex gap-0.5 justify-center flex-wrap">
                        {u.axes_autorises.map(a => (
                          <span key={a} className="text-[10px] bg-primary/10 text-primary
                            px-1 rounded font-mono">{a}</span>
                        ))}
                      </div>
                    ) : <span className="text-tertiary text-xs">—</span>}
                  </td>
                  <td className="text-center">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full',
                      u.actif ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
                      {u.actif ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="text-center text-xs text-secondary">
                    {u.derniere_connexion
                      ? new Date(u.derniere_connexion).toLocaleString('fr-FR',
                          {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})
                      : '—'}
                  </td>
                  <td className="text-center">
                    <div className="flex gap-1 justify-center">
                      <button onClick={() => openEdit(u)}
                        className="btn-ghost btn-sm"><Edit2 size={12}/></button>
                      {u.actif && (
                        <button onClick={() => {
                          if (confirm(`Désactiver ${u.prenom} ${u.nom} ?`))
                            mutDelete.mutate(u.id);
                        }} className="btn-danger btn-sm"><UserX size={12}/></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
