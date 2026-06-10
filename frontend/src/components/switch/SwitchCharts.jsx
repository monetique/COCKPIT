// src/components/switch/SwitchCharts.jsx
import { useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

const COLORS = ['#06b6d4','#10b981','#f59e0b','#f87171','#a78bfa','#34d399','#fb923c','#60a5fa','#e879f9'];
const TIP = { backgroundColor:'#181d2a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'8px', color:'#e8eaf0', fontSize:'12px' };

function parseFrDate(str) {
  if (!str) return null;
  const parts = String(str).trim().split('/');
  if (parts.length !== 3) return null;
  const d = new Date(+parts[2], +parts[1] - 1, +parts[0]);
  return isNaN(d) ? null : d;
}

export default function SwitchCharts({ allData }) {
  const { jourData, etatData, fspData, facturierData } = useMemo(() => {
    if (!allData.length) return { jourData:[], etatData:[], fspData:[], facturierData:[] };

    // Par jour
    const jourMap = {};
    allData.forEach(r => {
      if (!r['Date']) return;
      const parts = String(r['Date']).trim().split('/');
      if (parts.length < 2) return;
      const label = `${parts[0]}/${parts[1]}`;
      jourMap[label] = (jourMap[label] || 0) + 1;
    });
    const jourData = Object.entries(jourMap)
      .sort((a, b) => {
        const pa = a[0].split('/'), pb = b[0].split('/');
        return (+pa[1] - +pb[1]) || (+pa[0] - +pb[0]);
      })
      .map(([day, count]) => ({ day, count }));

    // Par état
    const etatMap = {};
    allData.forEach(r => { const v = r['Etat'] || 'N/A'; etatMap[v] = (etatMap[v] || 0) + 1; });
    const etatData = Object.entries(etatMap).map(([name, value]) => ({ name, value }));

    // Par FSP
    const fspMap = {};
    allData.forEach(r => { const v = r['FSP'] || 'N/A'; fspMap[v] = (fspMap[v] || 0) + 1; });
    const fspData = Object.entries(fspMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value }));

    // Top facturiers
    const facMap = {};
    allData.forEach(r => { const v = r['Facturier']; if (v) facMap[v] = (facMap[v] || 0) + 1; });
    const facturierData = Object.entries(facMap).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, value]) => ({ name, value }));

    return { jourData, etatData, fspData, facturierData };
  }, [allData]);

  if (!allData.length) return null;

  return (
    <div className="space-y-4">
      {/* Ligne 1 : Transactions/jour + Répartition états */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Transactions par jour</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={jourData}>
              <XAxis dataKey="day" tick={{ fontSize:10, fill:'#565e73' }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fontSize:10, fill:'#565e73' }} axisLine={false} tickLine={false} width={35}/>
              <Tooltip contentStyle={TIP} formatter={v => [v.toLocaleString('fr-FR'), 'Transactions']}/>
              <Line type="monotone" dataKey="count" stroke="#06b6d4" strokeWidth={2} dot={false} fill="rgba(6,182,212,0.08)"/>
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Répartition par état</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={etatData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={35} paddingAngle={2}>
                {etatData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
              </Pie>
              <Tooltip contentStyle={TIP}/>
              <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize:11, color:'#8b92a5' }}>{v}</span>}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Ligne 2 : FSP + Top facturiers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Répartition par FSP</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={fspData} barSize={18}>
              <XAxis dataKey="name" tick={{ fontSize:10, fill:'#565e73' }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fontSize:10, fill:'#565e73' }} axisLine={false} tickLine={false} width={35}/>
              <Tooltip contentStyle={TIP}/>
              <Bar dataKey="value" radius={[3,3,0,0]}>
                {fspData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Top Facturiers</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={facturierData} layout="vertical" barSize={12}>
              <XAxis type="number" tick={{ fontSize:10, fill:'#565e73' }} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize:10, fill:'#8b92a5', fontFamily:'DM Mono' }} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={TIP}/>
              <Bar dataKey="value" radius={[0,3,3,0]} fill="#06b6d4"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Heatmap */}
      <HeatmapPanel allData={allData}/>
    </div>
  );
}

// ── Heatmap Jour × Heure ─────────────────────────────────
function HeatmapPanel({ allData }) {
  const { grid, maxVal } = useMemo(() => {
    const grid = {};
    let maxVal = 0;
    allData.forEach(r => {
      if (!r['Date'] || !r['Heure']) return;
      const d = parseFrDate(String(r['Date']));
      if (!d) return;
      const dow   = d.getDay();
      const heure = parseInt(String(r['Heure']).slice(0, 2));
      if (isNaN(heure)) return;
      const k = `${dow}_${heure}`;
      grid[k] = (grid[k] || 0) + 1;
      if (grid[k] > maxVal) maxVal = grid[k];
    });
    return { grid, maxVal };
  }, [allData]);

  const JOURS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  if (maxVal === 0) return null;

  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-4">
        Heatmap — Activité par heure et jour de la semaine
      </div>
      <div className="overflow-x-auto">
        <table style={{ borderCollapse:'separate', borderSpacing:'3px', fontSize:'0.68rem' }}>
          <thead>
            <tr>
              <th className="text-tertiary font-medium pr-2 text-right" style={{ minWidth: 36 }}></th>
              {HOURS.map(h => (
                <th key={h} className="text-tertiary font-medium text-center" style={{ minWidth: 32 }}>
                  {String(h).padStart(2,'0')}h
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {JOURS.map((jour, dow) => (
              <tr key={dow}>
                <td className="text-tertiary font-semibold text-right pr-2 whitespace-nowrap">{jour}</td>
                {HOURS.map(h => {
                  const v     = grid[`${dow}_${h}`] || 0;
                  const ratio = maxVal > 0 ? v / maxVal : 0;
                  const alpha = ratio === 0 ? 0.04 : 0.1 + ratio * 0.85;
                  const rr    = Math.round(6   + ratio * 220);
                  const gg    = Math.round(182 - ratio * 80);
                  const bb    = Math.round(212 - ratio * 160);
                  return (
                    <td key={h}
                      title={`${jour} ${String(h).padStart(2,'0')}h : ${v} transaction(s)`}
                      style={{
                        width: '32px', height: '26px',
                        borderRadius: '4px', textAlign: 'center',
                        fontFamily: 'DM Mono, monospace',
                        color: '#e8eaf0',
                        background: `rgba(${rr},${gg},${bb},${alpha.toFixed(2)})`,
                        cursor: 'default',
                      }}>
                      {v > 0 ? v : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <span className="text-xs text-tertiary">Intensité :</span>
        {[0.04, 0.2, 0.4, 0.6, 0.85].map((a, i) => (
          <div key={i} className="flex items-center gap-1">
            <div style={{ width:14, height:14, borderRadius:3, background:`rgba(6,182,212,${a})` }}/>
            {i === 0 && <span className="text-xs text-tertiary">Faible</span>}
            {i === 4 && <span className="text-xs text-tertiary">Fort</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
