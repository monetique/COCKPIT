// src/pages/PlaceholderPage.jsx — Page temporaire pour les modules en cours
import { Construction } from 'lucide-react';

export default function PlaceholderPage({ title = 'Module en cours de développement' }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 animate-fade-in">
      <div className="w-14 h-14 rounded-2xl bg-warning-dim flex items-center justify-center">
        <Construction size={24} className="text-warning" />
      </div>
      <div className="text-center">
        <h2 className="text-lg font-semibold text-primary">{title}</h2>
        <p className="text-sm text-tertiary mt-1">
          Ce module sera disponible dans la prochaine phase de développement.
        </p>
      </div>
    </div>
  );
}
