import React, { useState } from 'react';
import {
  Anchor,
  BookOpen,
  Building2,
  Compass,
  Hammer,
  Lock,
  Search,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import {
  RECIPES,
  computeRecipeCost,
  getIslandRadius,
  getPlayerLevelFromXp,
  getRaftBuildSpec,
  getRaftCapacity,
  getRefineryMultiplier,
  type LiveWorldState,
  type PlayerProgress,
  type RecipeCategory,
  type RecipeDefinition,
} from '../shared/gameCatalog';

interface FabricatorModalProps {
  open: boolean;
  onClose: () => void;
  worldState: LiveWorldState;
  localProgress: PlayerProgress;
  onCraft: (recipeId: string, raftId?: string) => void;
}

interface AlmanacSource {
  title: string;
  uri: string;
}

const TAB_ITEMS: Array<{ id: RecipeCategory; label: string; icon: React.ReactNode }> = [
  { id: 'tools', label: 'Attrezzi', icon: <Wrench className="h-4 w-4" /> },
  { id: 'rafts_gear', label: 'Zattere & Gear', icon: <Anchor className="h-4 w-4" /> },
  { id: 'structures', label: 'Strutture Isola', icon: <Building2 className="h-4 w-4" /> },
  { id: 'island', label: 'Isola & Atlante', icon: <Sparkles className="h-4 w-4" /> },
];

export const FabricatorModal: React.FC<FabricatorModalProps> = ({
  open,
  onClose,
  worldState,
  localProgress,
  onCraft,
}) => {
  const [activeTab, setActiveTab] = useState<RecipeCategory>('tools');
  const [selectedRaftId, setSelectedRaftId] = useState<string>(worldState.rafts[0]?.id || 'raft-1');
  const [almanacQuery, setAlmanacQuery] = useState('');
  const [almanacLoading, setAlmanacLoading] = useState(false);
  const [almanacAnswer, setAlmanacAnswer] = useState<string | null>(null);
  const [almanacSources, setAlmanacSources] = useState<AlmanacSource[]>([]);
  const [almanacError, setAlmanacError] = useState<string | null>(null);

  if (!open) return null;

  const targetRaft =
    worldState.rafts.find((r) => r.id === selectedRaftId) || worldState.rafts[0];
  const xpInfo = getPlayerLevelFromXp(localProgress.xp);

  const getCurrentLevel = (recipeId: string): number => {
    switch (recipeId) {
      case 'tool_magnet_net':
        return localProgress.tools.magnetNetLv;
      case 'tool_harpoon':
        return localProgress.tools.harpoonLv;
      case 'tool_solar_lance':
        return localProgress.tools.solarLanceLv;
      case 'craft_repair_kit':
        return localProgress.repairKits;
      case 'raft_upgrade':
        return targetRaft?.level || 1;
      case 'raft_engine':
        return targetRaft?.engineLevel || 0;
      case 'raft_build_extra':
        return worldState.rafts.length;
      case 'gear_fins':
        return localProgress.gear.swimSpeedLv;
      case 'gear_backpack':
        return localProgress.gear.backpackLv;
      case 'gear_storm_suit':
        return localProgress.gear.stormSuitLv;
      case 'struct_dock':
        return worldState.structures.dockLevel;
      case 'struct_refinery':
        return worldState.structures.refineryLevel;
      case 'struct_platform':
        return worldState.structures.platformLevel;
      case 'struct_autocollector':
        return worldState.structures.autoCollectorLevel;
      case 'struct_lighthouse':
        return worldState.structures.lighthouseLevel;
      case 'struct_bay_shield':
        return worldState.structures.bayShieldLevel;
      case 'island_upgrade':
        return worldState.islandLevel;
      default:
        return 0;
    }
  };

  const tabRecipes = RECIPES.filter((r) => r.category === activeTab);

  const askAlmanac = async (queryStr: string) => {
    const q = queryStr.trim();
    if (!q) return;
    setAlmanacLoading(true);
    setAlmanacError(null);
    try {
      const res = await fetch('/api/almanac', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAlmanacError(data.error || 'Errore nella ricerca.');
      } else {
        setAlmanacAnswer(data.answer);
        setAlmanacSources(data.sources || []);
      }
    } catch {
      setAlmanacError('Impossibile contattare l’Atlante Oceanico.');
    } finally {
      setAlmanacLoading(false);
    }
  };

  const renderRecipeCard = (recipe: RecipeDefinition) => {
    const curLv = getCurrentLevel(recipe.id);
    const isMax = !recipe.consumable && curLv >= recipe.maxLevel;

    const isBuildRaft = recipe.id === 'raft_build_extra';
    const raftBuildSpec = isBuildRaft ? getRaftBuildSpec(worldState.rafts.length) : null;
    const cost = raftBuildSpec ? raftBuildSpec.cost : computeRecipeCost(recipe, curLv);
    const reqIsland = raftBuildSpec ? raftBuildSpec.requiredIslandLevel : recipe.requiredIslandLevel;
    const reqPlayer = raftBuildSpec ? raftBuildSpec.requiredPlayerLevel : recipe.requiredPlayerLevel;

    const requiresExistingRaft =
      (recipe.id === 'raft_upgrade' || recipe.id === 'raft_engine') &&
      worldState.rafts.length === 0;

    const islandOk = worldState.islandLevel >= reqIsland;
    const playerOk = localProgress.level >= reqPlayer;
    const unlocked = islandOk && playerOk && !requiresExistingRaft;
    const canAfford = worldState.bankCubes >= cost;

    const displayName =
      isBuildRaft && worldState.rafts.length === 0 ? 'Costruisci Prima Zattera' : recipe.name;

    return (
      <div
        key={recipe.id}
        className={`flex flex-col justify-between rounded-xl border p-4 transition-colors ${
          !unlocked
            ? 'border-slate-700/80 bg-slate-900/60 opacity-80'
            : isMax
              ? 'border-emerald-500/40 bg-emerald-950/25'
              : 'border-white/15 bg-slate-800/85'
        }`}
      >
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-sm font-bold text-white">{displayName}</h3>
            <span className="shrink-0 rounded-md bg-slate-950 px-2 py-0.5 text-[11px] font-bold text-cyan-300 tabular-nums">
              {recipe.consumable ? `Posseduti: ${curLv}` : `Lv. ${curLv}/${recipe.maxLevel}`}
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{recipe.description}</p>
          <p className="mt-2 rounded-lg bg-slate-950/75 px-2.5 py-1.5 text-[11px] font-medium text-amber-300">
            {recipe.effectSummary}
          </p>
        </div>

        <div className="mt-3.5 flex items-center justify-between gap-2 pt-2 border-t border-white/10">
          {!unlocked ? (
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-300">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              <span>
                {requiresExistingRaft
                  ? 'Costruisci prima una zattera (4 ■)'
                  : `${!islandOk ? `Isola Lv.${reqIsland}` : ''}${!islandOk && !playerOk ? ' · ' : ''}${!playerOk ? `Giocatore Lv.${reqPlayer}` : ''}`}
              </span>
            </div>
          ) : (
            <div className="text-xs font-semibold text-slate-300 tabular-nums">
              +{recipe.xpReward} XP
            </div>
          )}

          {isMax ? (
            <span className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-300">
              Livello Max
            </span>
          ) : (
            <button
              type="button"
              disabled={!unlocked || !canAfford}
              onClick={() => onCraft(recipe.id, targetRaft?.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold tabular-nums cursor-pointer ${
                unlocked && canAfford
                  ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                  : 'bg-slate-700 text-slate-400 cursor-not-allowed'
              }`}
            >
              <Hammer className="h-3.5 w-3.5" />
              {cost} ■
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950/70 px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-extrabold text-white flex items-center gap-2">
              <Hammer className="h-5 w-5 text-amber-400" />
              Fabbricatore Evolutivo · Isola Lv.{worldState.islandLevel}
            </h2>
            <p className="text-xs text-slate-400 tabular-nums">
              Cassa Comune: <strong className="text-amber-400">{worldState.bankCubes} Cubi</strong> ·
              Giocatore Lv.<strong className="text-cyan-300">{localProgress.level}</strong> ({xpInfo.currentXp}/{xpInfo.nextLevelXp} XP) ·
              Raffineria <strong className="text-emerald-400">x{getRefineryMultiplier(worldState.structures.refineryLevel).toFixed(2)}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-white/10 bg-slate-900 px-6 py-3">
          {TAB_ITEMS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-colors cursor-pointer ${
                activeTab === t.id
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === 'rafts_gear' && worldState.rafts.length === 0 && (
            <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              Nessuna zattera attiva: raccogli <strong className="text-amber-300">4 Cubi</strong> lanciando il Retino in mare e costruisci la tua <strong className="text-white">Prima Zattera</strong>!
            </div>
          )}

          {activeTab === 'rafts_gear' && worldState.rafts.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-3">
              <div className="text-xs text-cyan-200">
                Seleziona la zattera da potenziare (Capacità attuale:{' '}
                <strong className="tabular-nums">{targetRaft?.capacity || 4} cubi</strong> · Prossima:{' '}
                <strong className="tabular-nums">
                  {getRaftCapacity(Math.min(5, (targetRaft?.level || 1) + 1))} cubi
                </strong>
                )
              </div>
              <div className="flex gap-2">
                {worldState.rafts.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRaftId(r.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold cursor-pointer ${
                      targetRaft?.id === r.id
                        ? 'bg-cyan-500 text-slate-950'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {r.name} (Lv.{r.level})
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {tabRecipes.map(renderRecipeCard)}
          </div>

          {activeTab === 'island' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-slate-800/60 p-4 text-xs text-slate-300 flex flex-wrap gap-6 tabular-nums">
                <div>
                  <span className="text-slate-400">Raggio Isola:</span>{' '}
                  <strong className="text-white">{getIslandRadius(worldState.islandLevel).toFixed(1)}m</strong>
                </div>
                <div>
                  <span className="text-slate-400">Zattere Attive:</span>{' '}
                  <strong className="text-white">{worldState.rafts.length} / 3</strong>
                </div>
                <div>
                  <span className="text-slate-400">Droni/Boe Auto:</span>{' '}
                  <strong className="text-cyan-300">Lv.{worldState.structures.autoCollectorLevel}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Faro:</span>{' '}
                  <strong className="text-amber-300">Lv.{worldState.structures.lighthouseLevel}</strong>
                </div>
              </div>

              {/* Ocean Almanac (Gemini Search Grounding) */}
              <div className="rounded-xl border border-cyan-500/30 bg-slate-950/75 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-cyan-300">
                  <BookOpen className="h-4 w-4" />
                  Atlante Oceanico (Ricerca Reale su Mare, Squali &amp; Correnti)
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Chiedi curiosità reali sui fenomeni marini che affronti in navigazione con fonti web aggiornate.
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    'Come si formano le onde anomale in mare aperto?',
                    'Come funzionano le correnti oceaniche superficiali?',
                    'Quali squali vivono in mare aperto e come orientarsi con i fari?',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setAlmanacQuery(preset);
                        askAlmanac(preset);
                      }}
                      className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-200 hover:border-cyan-400/50 cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    askAlmanac(almanacQuery);
                  }}
                >
                  <input
                    type="text"
                    value={almanacQuery}
                    onChange={(e) => setAlmanacQuery(e.target.value)}
                    placeholder="Cerca nell'Atlante Oceanico..."
                    className="w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={almanacLoading || !almanacQuery.trim()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 cursor-pointer"
                  >
                    <Search className="h-3.5 w-3.5" />
                    {almanacLoading ? 'Cerco...' : 'Cerca'}
                  </button>
                </form>

                {almanacError && (
                  <div className="mt-3 rounded-lg border border-rose-500/35 bg-rose-950/40 px-3.5 py-2.5 text-xs leading-relaxed text-rose-200">
                    {almanacError}
                  </div>
                )}

                {almanacAnswer && (
                  <div className="mt-3 rounded-lg border border-white/10 bg-slate-900 p-3 text-xs leading-relaxed text-slate-200">
                    <p>{almanacAnswer}</p>
                    {almanacSources.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-2 border-t border-white/10 pt-2">
                        <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                          <Compass className="h-3 w-3" /> Fonti:
                        </span>
                        {almanacSources.map((s) => (
                          <a
                            key={s.uri}
                            href={s.uri}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-cyan-300 underline hover:text-cyan-200"
                          >
                            {s.title}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
