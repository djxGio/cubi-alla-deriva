import React from 'react';
import {
  Anchor,
  BookOpenCheck,
  CheckCircle2,
  Circle,
  Hammer,
  Sparkles,
  Waves,
  X,
} from 'lucide-react';
import type { LivePlayerState, LiveWorldState } from '../shared/gameCatalog';

interface TutorialPanelProps {
  open: boolean;
  worldState: LiveWorldState;
  localPlayer?: LivePlayerState;
  hasCastTool: boolean;
  onOpenFabricator: () => void;
  onClose: () => void;
}

export const TutorialPanel: React.FC<TutorialPanelProps> = ({
  open,
  worldState,
  localPlayer,
  hasCastTool,
  onOpenFabricator,
  onClose,
}) => {
  if (!open) return null;

  const carried = localPlayer?.carriedCubes.length || 0;
  const bankCubes = worldState.bankCubes;
  const hasRaft = worldState.rafts.length > 0;
  const isPiloting = localPlayer?.mode === 'piloting';

  const step1Done = hasCastTool || bankCubes > 0 || carried > 0 || hasRaft;
  const step2Done = bankCubes >= 4 || hasRaft;
  const step3Done = hasRaft;
  const step4Done = isPiloting;

  const completedCount = [step1Done, step2Done, step3Done, step4Done].filter(Boolean).length;
  const cubeProgress = Math.min(4, bankCubes);

  const steps = [
    {
      id: 1,
      done: step1Done,
      title: 'Lancia il Retino dalla riva',
      desc: 'Avvicinati alla spiaggia (WASD) e clicca sull’acqua o premi [Spazio] per lanciare il Retino sui cubi azzurri.',
    },
    {
      id: 2,
      done: step2Done,
      title: `Raccogli i primi 4 Cubi (${cubeProgress}/4 ■)`,
      desc:
        carried > 0
          ? `Hai ${carried} cubi nello zaino: torna sulla sabbia per depositarli in Banca! Attento: in acqua hai solo 10s di Ossigeno.`
          : 'Lanciando dalla riva i cubi vanno subito in Banca. Se nuoti in mare hai 10 secondi di Ossigeno prima di subire danni.',
    },
    {
      id: 3,
      done: step3Done,
      title: 'Costruisci la Zattera Base (4 ■)',
      desc: 'Apri il Fabbricatore [F], seleziona la scheda “Zattere & Gear” e fabbrica la tua Prima Zattera.',
      action: !hasRaft ? (
        <button
          type="button"
          onClick={onOpenFabricator}
          className={`mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-extrabold cursor-pointer ${
            bankCubes >= 4
              ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          <Hammer className="h-3.5 w-3.5" />
          {bankCubes >= 4 ? 'Apri Fabbricatore (Pronto!)' : 'Apri Fabbricatore [F]'}
        </button>
      ) : null,
    },
    {
      id: 4,
      done: step4Done,
      title: 'Salpa ed esplora il mare',
      desc: 'Avvicinati alla Zattera, premi [E] per salire a bordo (4 posti iniziali) e naviga verso i cubi più lontani!',
    },
  ];

  return (
    <div className="pointer-events-auto w-80 max-w-[calc(100vw-1.5rem)] self-start rounded-2xl border border-cyan-400/30 bg-slate-900/94 p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-cyan-300">
            <BookOpenCheck className="h-3.5 w-3.5" />
            Benvenuto sull’Isola
          </div>
          <h3 className="font-display text-sm font-extrabold text-white mt-0.5">
            Guida Rapida: Prima Zattera
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Chiudi guida"
          className="rounded-lg bg-slate-800 p-1 text-slate-400 hover:bg-slate-700 hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Live 4-cube progress bar */}
      {!hasRaft && (
        <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/75 p-2.5">
          <div className="flex items-center justify-between text-[11px] font-bold tabular-nums">
            <span className="inline-flex items-center gap-1 text-amber-300">
              <Waves className="h-3.5 w-3.5 text-cyan-400" />
              Cubi per la Zattera
            </span>
            <span className="text-white">{cubeProgress} / 4 ■</span>
          </div>
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {[0, 1, 2, 3].map((slot) => (
              <div
                key={slot}
                className={`h-2 rounded-full transition-colors ${
                  slot < cubeProgress ? 'bg-amber-400' : 'bg-slate-800'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Interactive step checklist */}
      <div className="mt-3 space-y-2.5">
        {steps.map((s) => (
          <div
            key={s.id}
            className={`rounded-xl border px-3 py-2 text-xs transition-colors ${
              s.done
                ? 'border-emerald-500/35 bg-emerald-950/25'
                : 'border-white/10 bg-slate-800/70'
            }`}
          >
            <div className="flex items-start gap-2">
              {s.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={`font-bold ${
                    s.done ? 'text-emerald-300 line-through opacity-85' : 'text-white'
                  }`}
                >
                  {s.id}. {s.title}
                </div>
                {!s.done && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">{s.desc}</p>
                )}
                {!s.done && s.action}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer completion or progress */}
      <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2.5 text-[11px]">
        {completedCount === 4 ? (
          <span className="inline-flex items-center gap-1.5 font-bold text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            Pronto a salpare! Buon viaggio!
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-slate-400 tabular-nums">
            <Anchor className="h-3.5 w-3.5 text-cyan-400" />
            Progresso: {completedCount}/4 passi
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="font-bold text-cyan-300 hover:text-cyan-200 cursor-pointer"
        >
          {completedCount === 4 ? 'Completa' : 'Nascondi'}
        </button>
      </div>
    </div>
  );
};
