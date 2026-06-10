// src/components/transactions/TransactionCharts.jsx
// Graphiques reflétant exactement le résultat de la recherche active
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

const COLORS = ['#10b981','#f87171','#60a5fa','#f59e0b','#a78bfa','#34d399','#fb923c','#e879f9'];

const TT = {
  backgroundColor: '#181d2a',
  border         : '1px solid rgba(255,255,255,0.08)',
  borderRadius   : '8px',
  color          : '#e8eaf0',
  fontSize       : '12px',
};

export default function TransactionCharts({ data }) {
  if (!data?.data?.length) return null;
  const rows = data.data;

  // ── Graphique 1 : Répartition par état ────────────────
  const stateMap = {};
  rows.forEach(r => {
    const s = r.PAYMENT_STATE || 'UNKNOWN';
    stateMap[s] = (stateMap[s] || 0) + 1;
  });
  const stateData = Object.entries(stateMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // ── Graphique 2 : Top Action Code (description) ≠ 0 ──
  // TEXT contient la description de l'action code
  const acMap = {};
  rows.forEach(r => {
    const code = r.ACTION_CODE_INT;
    if (!code || code === 0 || code === '0') return;   // exclure code 0
    // Clé = "code — description" si TEXT disponible, sinon juste le code
    const desc = (r.TEXT || '').trim();
    const label = desc ? `${code} — ${desc}` : String(code);
    acMap[label] = (acMap[label] || 0) + 1;
  });
  const acData = Object.entries(acMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // Tronquer le label pour l'axe Y (max 28 chars)
  const truncLabel = (s) => s.length > 28 ? s.slice(0, 26) + '…' : s;

  // ── Graphique 3 : Top Marchands (nom complet) ─────────
  const mchMap = {};
  rows.forEach(r => {
    // Préférer le nom complet, fallback sur Processing ID
    const name = (r.MERCHANTFULLNAME || '').trim() || r.PROCESSING_ID;
    if (!name) return;
    mchMap[name] = (mchMap[name] || 0) + 1;
  });
  const mchData = Object.entries(mchMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map(d => ({ ...d, shortName: d.name.length > 22 ? d.name.slice(0, 20) + '…' : d.name }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

      {/* Répartition par état */}
      <div className="card p-4">
        <div className="text-xs font-semibold text-secondary mb-3 uppercase tracking-wide">
          Répartition par état
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={stateData} dataKey="value" nameKey="name"
              cx="50%" cy="50%" outerRadius={65} innerRadius={35}
              paddingAngle={2}
            >
              {stateData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TT} />
            <Legend
              iconType="circle" iconSize={8}
              formatter={(v) => <span style={{ fontSize:11, color:'#8b92a5' }}>{v}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Top Action Code ≠ 0 */}
      <div className="card p-4">
        <div className="text-xs font-semibold text-secondary mb-3 uppercase tracking-wide">
          Top Action Code ≠ 0
        </div>
        {acData.length === 0 ? (
          <div className="flex items-center justify-center h-[180px] text-xs text-tertiary">
            Aucun refus dans cette sélection
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={acData} layout="vertical" barSize={11}>
              <XAxis
                type="number"
                tick={{ fontSize:10, fill:'#565e73' }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                type="category" dataKey="name" width={110}
                tickFormatter={truncLabel}
                tick={{ fontSize:9, fill:'#8b92a5' }}
                axisLine={false} tickLine={false}
              />
              <Tooltip
                contentStyle={TT}
                formatter={(v, _, props) => [v, props.payload.name]}
                labelFormatter={() => ''}
              />
              <Bar dataKey="value" fill="#f87171" radius={[0,3,3,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top Marchands */}
      <div className="card p-4">
        <div className="text-xs font-semibold text-secondary mb-3 uppercase tracking-wide">
          Top Marchands
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={mchData} layout="vertical" barSize={11}>
            <XAxis
              type="number"
              tick={{ fontSize:10, fill:'#565e73' }}
              axisLine={false} tickLine={false}
            />
            <YAxis
              type="category" dataKey="shortName" width={88}
              tick={{ fontSize:9, fill:'#8b92a5' }}
              axisLine={false} tickLine={false}
            />
            <Tooltip
              contentStyle={TT}
              formatter={(v, _, props) => [v, props.payload.name]}
              labelFormatter={() => ''}
            />
            <Bar dataKey="value" fill="#10b981" radius={[0,3,3,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
