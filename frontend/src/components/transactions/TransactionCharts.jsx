import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Loader2 } from 'lucide-react';

const COLORS = ['#10b981','#f87171','#60a5fa','#f59e0b','#a78bfa','#34d399','#fb923c','#e879f9'];
const trunc = (s) => s && s.length > 28 ? s.slice(0,26)+'...' : (s||'');

export default function TransactionCharts({ data, loading }) {
  if (loading) return (
    <div className="flex items-center justify-center h-32 text-secondary text-xs gap-2">
      <Loader2 size={14} className="animate-spin"/> Chargement...
    </div>
  );
  if (!data) return null;

  const stateData = [
    { name: 'Deposited', value: Number(data.deposited||0), color:'#22c55e' },
    { name: 'Declined',  value: Number(data.declined ||0), color:'#ef4444' },
    { name: 'Started',   value: Number(data.started  ||0), color:'#f59e0b' },
    { name: 'Others',    value: Number(data.others   ||0), color:'#64748b' },
  ].filter(d => d.value > 0);

  const acData  = (data.topActionCodes||[]).map(r=>({ name: trunc(r.label||String(r.code)), value: Number(r.count) })).sort((a,b)=>b.value-a.value).slice(0,8);
  const mchData = (data.topMerchants  ||[]).map(r=>({ name: trunc(r.name||r.processing_id),  value: Number(r.count) })).sort((a,b)=>b.value-a.value).slice(0,8);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
      {stateData.length > 0 && (
        <div className="card p-4">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Repartition par etat</div>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={stateData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2}>
                {stateData.map((e,i) => <Cell key={i} fill={e.color}/>)}
              </Pie>
              <Tooltip formatter={(v,n)=>[v.toLocaleString('fr-FR'),n]} contentStyle={{fontSize:11,borderRadius:6}}/>
              <Legend formatter={n=><span style={{fontSize:10}}>{n}</span>}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
      {acData.length > 0 && (
        <div className="card p-4">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Top Action Codes</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={acData} layout="vertical" margin={{left:4,right:16,top:0,bottom:0}}>
              <XAxis type="number" tick={{fontSize:9}} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" width={110} tick={{fontSize:9}} axisLine={false} tickLine={false}/>
              <Tooltip formatter={(v)=>[v.toLocaleString('fr-FR'),'Transactions']} contentStyle={{fontSize:11,borderRadius:6}}/>
              <Bar dataKey="value" radius={[0,3,3,0]} maxBarSize={16}>
                {acData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {mchData.length > 0 && (
        <div className="card p-4">
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Top Marchands</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={mchData} layout="vertical" margin={{left:4,right:16,top:0,bottom:0}}>
              <XAxis type="number" tick={{fontSize:9}} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" width={110} tick={{fontSize:9}} axisLine={false} tickLine={false}/>
              <Tooltip formatter={(v)=>[v.toLocaleString('fr-FR'),'Transactions']} contentStyle={{fontSize:11,borderRadius:6}}/>
              <Bar dataKey="value" radius={[0,3,3,0]} maxBarSize={16}>
                {mchData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
