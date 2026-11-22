import React, { useState } from 'react';
import {
  Anchor,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Hammer,
  Heart,
  LogOut,
  Users,
  Volume2,
  VolumeX,
  Wrench,
  ZoomIn,
  ZoomOut,
  AlertTriangle,
  Sun,
  Moon,
  BedDouble,
  CloudRain,
  CloudLightning,
  Wind,
  HelpCircle,
  Store,
  Utensils,
  FlaskConical,
} from 'lucide-react';
import { TutorialPanel } from './TutorialPanel';
import {
  getBackpackCapacity,
  getPlayerLevelFromXp,
  isNightTime,
  type GameEventToast,
  type LiveWorldState,
  type PlayerProgress,
  type ToolId,
} from '../shared/gameCatalog';
import type { WorldHudPrompts } from '../game/WorldEngine';

interface GameHudProps {
  worldState: LiveWorldState;
  localUid: string;
  prompts: WorldHudPrompts;
  toasts: GameEventToast[];
  muted: boolean;
  hasCastTool?: boolean;
  onToggleMute: () => void;
  onOpenFabricator: () => void;
  onOpenMarket: () => void;
  onSleep: () => void;
  onUsePotion: () => void;
  onUseFood: () => void;
  onInteract: () => void;
  onDeposit: () => void;
  onUseTool: () => void;
  onRepairRaft: () => void;
  onSelectTool: (tool: ToolId) => void;
  onZoom: (delta: number) => void;
  onLeaveRoom: () => void;
}

const TOOL_LABELS: Array<{ id: ToolId; name: string; keyHint: string }> = [
  { id: 'net', name: 'Retino', keyHint: '1' },
  { id: 'magnet_net', name: 'Rete Magnetica', keyHint: '2' },
  { id: 'harpoon', name: 'Arpione', keyHint: '3' },
  { id: 'solar_lance', name: 'Lancia Solare', keyHint: '4' },
];

export const GameHud: React.FC<GameHudProps> = ({
  worldState,
  localUid,
  prompts,
  toasts,
  muted,
  hasCastTool = false,
  onToggleMute,
  onOpenFabricator,
  onOpenMarket,
  onSleep,
  onUsePotion,
  onUseFood,
  onInteract,
  onDeposit,
  onUseTool,
  onRepairRaft,
  onSelectTool,
  onZoom,
  onLeaveRoom,
}) => {
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(() => worldState.rafts.length === 0);

  const localPlayer = worldState.players[localUid];
  const localProgress: PlayerProgress | undefined = worldState.playerProgress[localUid];
  const activeRaft = localPlayer?.pilotingRaftId
    ? worldState.rafts.find((r) => r.id === localPlayer.pilotingRaftId)
    : worldState.rafts[0];

  const xpInfo = getPlayerLevelFromXp(localProgress?.xp || 0);
  const backpackCap = getBackpackCapacity(localProgress?.gear.backpackLv || 1);
  const onlinePlayers = Object.values(worldState.players);

  const isToolUnlocked = (id: ToolId) => {
    if (!localProgress) return id === 'net';
    if (id === 'net') return true;
    if (id === 'magnet_net') return localProgress.tools.magnetNetLv > 0;
    if (id === 'harpoon') return localProgress.tools.harpoonLv > 0;
    if (id === 'solar_lance') return localProgress.tools.solarLanceLv > 0;
    return false;
  };

  const copyRoomCode = () => {
    navigator.clipboard?.writeText(worldState.roomCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const zoneLabel =
    prompts.distanceFromIsland < 45
      ? 'Laguna Calma'
      : prompts.distanceFromIsland < 110
        ? 'Barriera Turchese (Squali)'
        : 'Mare Aperto (Tempeste & Cubi Rari)';

  const dayState = worldState.dayState || { day: 1, timeOfDay: 0.14, cycleDurationSec: 90 };
  const isNightPhase = isNightTime(dayState.timeOfDay);
  const dayPhaseLabel =
    dayState.timeOfDay < 0.22
      ? 'Mattina'
      : dayState.timeOfDay < 0.62
        ? 'Giorno'
        : dayState.timeOfDay < 0.78
          ? 'Tramonto'
          : 'Notte';

  const weather = worldState.weather || { phase: 'sunny', intensity: 0, nextChangeInSec: 45 };
  const weatherInfo =
    weather.phase === 'heavy_storm'
      ? {
          label: 'Tempesta Intensa',
          icon: <CloudLightning className="h-3.5 w-3.5 text-amber-300" />,
          cls: 'bg-amber-500/20 text-amber-200',
        }
      : weather.phase === 'light_rain'
        ? {
            label: 'Pioggia Leggera',
            icon: <CloudRain className="h-3.5 w-3.5 text-sky-300" />,
            cls: 'bg-sky-500/20 text-sky-200',
          }
        : {
            label: 'Soleggiato',
            icon: <Sun className="h-3.5 w-3.5 text-yellow-300" />,
            cls: 'bg-yellow-500/15 text-yellow-200',
          };

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-3 sm:p-4">
      {/* Top Perimeter Bar */}
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        {/* Left: Bank Cubes, Island Level, Player Level */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-white/15 bg-slate-900/88 px-3.5 py-2 shadow-lg">
          <div className="flex items-center gap-2 pr-3 border-r border-white/10">
            <span className="inline-block h-3.5 w-3.5 rounded-sm bg-amber-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Cubi Banca</div>
              <div className="font-display text-base font-extrabold text-amber-400 tabular-nums leading-tight">
                {worldState.bankCubes}
              </div>
            </div>
          </div>

          <div className="pr-3 border-r border-white/10">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Isola</div>
            <div className="font-display text-sm font-bold text-white tabular-nums">
              Lv.{worldState.islandLevel}
            </div>
          </div>

          <div className="min-w-[110px]">
            <div className="flex items-center justify-between text-[10px] font-semibold text-cyan-300 tabular-nums">
              <span>Giocatore Lv.{localProgress?.level || 1}</span>
              <span>
                {xpInfo.currentXp}/{xpInfo.nextLevelXp}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-cyan-400 transition-all duration-200"
                style={{ width: `${Math.min(100, (xpInfo.currentXp / xpInfo.nextLevelXp) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Center: Day Cycle, Zone Distance, Dynamic Weather & Storm Alert */}
        <div className="hidden md:flex items-center gap-2 rounded-xl border border-white/15 bg-slate-900/85 px-3.5 py-2 text-xs font-semibold text-slate-200 tabular-nums shadow-lg">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${
              isNightPhase ? 'bg-indigo-500/25 text-indigo-200' : 'bg-amber-500/15 text-amber-200'
            }`}
          >
            {isNightPhase ? <Moon className="h-3.5 w-3.5 text-indigo-300" /> : <Sun className="h-3.5 w-3.5 text-amber-300" />}
            Giorno {dayState.day} · {dayPhaseLabel}
          </span>
          {isNightPhase && (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/20 px-2 py-0.5 text-[11px] font-bold text-rose-200">
              Squali + · Cubi Rari +
            </span>
          )}
          <span className="text-slate-500">·</span>
          <span>{zoneLabel}</span>
          <span className="text-slate-500">·</span>
          <span className="text-cyan-300">{prompts.distanceFromIsland}m dall’isola</span>
          <span className="text-slate-500">·</span>
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${weatherInfo.cls}`}>
            {weatherInfo.icon}
            {weatherInfo.label}
          </span>
          {prompts.inStorm && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-md bg-rose-500/25 px-2 py-0.5 text-rose-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Cella Temporalesca
            </span>
          )}
        </div>

        {/* Right: Room Code, Co-op Players, Leave */}
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/15 bg-slate-900/88 px-3 py-2 shadow-lg">
          <button
            type="button"
            onClick={copyRoomCode}
            title="Copia codice invito"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-bold tracking-wider text-cyan-300 hover:bg-slate-700 cursor-pointer"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {worldState.roomCode}
          </button>

          <div className="flex items-center gap-1.5 px-1 text-xs text-slate-200 tabular-nums">
            <Users className="h-3.5 w-3.5 text-slate-400" />
            <span>{onlinePlayers.length}</span>
            <div className="flex -space-x-1">
              {onlinePlayers.slice(0, 4).map((p) => (
                <span
                  key={p.uid}
                  title={p.displayName}
                  className="inline-block h-3 w-3 rounded-full border border-slate-900"
                  style={{ backgroundColor: p.color }}
                />
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setTutorialOpen((v) => !v)}
            title="Mostra/Nascondi Guida Rapida"
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold cursor-pointer ${
              tutorialOpen
                ? 'bg-cyan-500 text-slate-950'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Guida</span>
          </button>

          <button
            type="button"
            onClick={onLeaveRoom}
            title="Torna al Menu"
            className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Middle Row: Interactive Tutorial (Left) & Transient Event Toasts (Right) */}
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <TutorialPanel
            open={tutorialOpen}
            worldState={worldState}
            localPlayer={localPlayer}
            hasCastTool={hasCastTool}
            onOpenFabricator={onOpenFabricator}
            onClose={() => setTutorialOpen(false)}
          />
        </div>

        <div className="pointer-events-none flex flex-col items-end gap-1.5 max-w-xs ml-auto">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-white/10 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-slate-100 shadow-md"
              style={{ borderLeftWidth: '3px', borderLeftColor: t.color || '#38bdf8' }}
            >
              {t.message}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Area: Breath Bar, Contextual Prompt + Collapsible Control Dock */}
      <div className="mt-auto flex flex-col items-center gap-2">
        {localPlayer && (localPlayer.mode === 'swimming' || localPlayer.breath < localPlayer.maxBreath - 0.1) && (
          <div className="pointer-events-none w-72 rounded-xl border border-white/15 bg-slate-900/92 px-3.5 py-2 shadow-xl">
            <div className="flex items-center justify-between text-[11px] font-bold tabular-nums">
              <span className="inline-flex items-center gap-1.5 text-cyan-200">
                <Wind className="h-3.5 w-3.5 text-cyan-400" />
                {localPlayer.mode === 'swimming' ? 'Ossigeno' : 'Ossigeno (Recupero)'}
              </span>
              <span
                className={
                  localPlayer.breath <= 3
                    ? 'text-rose-400'
                    : localPlayer.breath <= 5.5
                      ? 'text-amber-300'
                      : 'text-cyan-300'
                }
              >
                {localPlayer.breath.toFixed(1)}s / {localPlayer.maxBreath}s
              </span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all duration-100 ${
                  localPlayer.breath <= 3
                    ? 'bg-rose-500'
                    : localPlayer.breath <= 5.5
                      ? 'bg-amber-400'
                      : 'bg-cyan-400'
                }`}
                style={{
                  width: `${Math.max(0, Math.min(100, (localPlayer.breath / localPlayer.maxBreath) * 100))}%`,
                }}
              />
            </div>
            {localPlayer.mode === 'swimming' && localPlayer.breath <= 3 && (
              <div className="mt-1 text-[10px] font-bold text-rose-300">
                Ossigeno critico! Torna sull’isola o sulla zattera!
              </div>
            )}
          </div>
        )}

        {/* Always-visible Bottom Survival Bars: Vita & Fame */}
        {localPlayer && (
          <div className="pointer-events-auto w-full max-w-md rounded-xl border border-white/15 bg-slate-900/92 px-3.5 py-2 shadow-xl">
            <div className="grid grid-cols-2 gap-3">
              {/* Barra della Vita */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-bold tabular-nums">
                  <span className="inline-flex items-center gap-1 text-rose-200">
                    <Heart className="h-3.5 w-3.5 text-rose-400 fill-rose-400/30" />
                    Vita
                  </span>
                  <span className={localPlayer.hp <= 30 ? 'text-rose-400' : 'text-rose-200'}>
                    {Math.round(localPlayer.hp)}/{localPlayer.maxHp}
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full transition-all duration-150 ${
                      localPlayer.hp <= 30 ? 'bg-rose-600' : 'bg-rose-500'
                    }`}
                    style={{
                      width: `${Math.max(0, Math.min(100, (localPlayer.hp / localPlayer.maxHp) * 100))}%`,
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={onUsePotion}
                  disabled={(localProgress?.potions || 0) <= 0 || localPlayer.hp >= localPlayer.maxHp}
                  title="Usa Pozione Vitale [H]"
                  className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-200 hover:bg-rose-500/30 disabled:opacity-40 tabular-nums cursor-pointer"
                >
                  <FlaskConical className="h-3 w-3 text-rose-400" />
                  [H] Pozione ({localProgress?.potions || 0})
                </button>
              </div>

              {/* Barra della Fame */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-bold tabular-nums">
                  <span className="inline-flex items-center gap-1 text-amber-200">
                    <Utensils className="h-3.5 w-3.5 text-amber-400" />
                    Fame
                  </span>
                  <span
                    className={
                      (localPlayer.hunger ?? 100) <= 20 ? 'text-rose-400' : 'text-amber-300'
                    }
                  >
                    {Math.round(localPlayer.hunger ?? 100)}/{localPlayer.maxHunger ?? 100}
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full transition-all duration-150 ${
                      (localPlayer.hunger ?? 100) <= 20 ? 'bg-rose-500' : 'bg-amber-400'
                    }`}
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(
                          100,
                          ((localPlayer.hunger ?? 100) / (localPlayer.maxHunger ?? 100)) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={onUseFood}
                  disabled={
                    (localProgress?.food || 0) <= 0 ||
                    (localPlayer.hunger ?? 100) >= (localPlayer.maxHunger ?? 100) - 0.5
                  }
                  title="Mangia Razione di Cibo [J]"
                  className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-200 hover:bg-amber-500/30 disabled:opacity-40 tabular-nums cursor-pointer"
                >
                  <Utensils className="h-3 w-3 text-amber-400" />
                  [J] Cibo ({localProgress?.food || 0})
                </button>
              </div>
            </div>
            {(localPlayer.hunger ?? 100) <= 0 && (
              <div className="mt-1.5 text-center text-[10px] font-bold text-rose-300">
                Fame a 0! Stai perdendo Vita: mangia cibo o visita il Mini Mercato sull’isola!
              </div>
            )}
          </div>
        )}

        {!tutorialOpen && worldState.rafts.length === 0 && (
          <div className="pointer-events-none rounded-xl border border-amber-400/35 bg-slate-900/90 px-3.5 py-1.5 text-xs font-semibold text-amber-200 shadow-lg">
            Raccogli <strong className="text-amber-300">4 cubi</strong> (clicca sull’acqua o premi{' '}
            <strong className="text-white">[Spazio]</strong> per lanciare il Retino) e fabbrica la{' '}
            <strong className="text-white">Zattera</strong>!
          </div>
        )}

        {/* Contextual Action Prompt */}
        <div className="pointer-events-auto flex flex-wrap justify-center gap-2">
          {prompts.nearMarket && (
            <button
              type="button"
              onClick={onOpenMarket}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-300/60 bg-rose-500 px-4 py-2 text-xs font-extrabold text-white shadow-lg hover:bg-rose-400 cursor-pointer"
            >
              <Store className="h-4 w-4" />
              [E] Apri Mini Mercato (Pozioni &amp; Cibo)
            </button>
          )}
          {prompts.nearBed && (
            <button
              type="button"
              onClick={onSleep}
              disabled={!isNightPhase}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-extrabold shadow-lg ${
                isNightPhase
                  ? 'border-orange-300/60 bg-orange-500 text-slate-950 hover:bg-orange-400 cursor-pointer'
                  : 'border-slate-600/60 bg-slate-800/95 text-slate-300 cursor-not-allowed'
              }`}
            >
              <BedDouble className="h-4 w-4" />
              {isNightPhase
                ? "[E] Dormi fino all'Alba (Nuovo Giorno & Rigenera Cubi)"
                : `Letto · Puoi dormire solo di notte (${dayPhaseLabel})`}
            </button>
          )}
          {prompts.nearFabricator && (
            <button
              type="button"
              onClick={onOpenFabricator}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-400/50 bg-amber-500 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-lg hover:bg-amber-400 cursor-pointer"
            >
              <Hammer className="h-4 w-4" />
              [E / F] Apri Fabbricatore
            </button>
          )}
          {prompts.nearRaftId && (
            <button
              type="button"
              onClick={onInteract}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/50 bg-cyan-500 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-lg hover:bg-cyan-400 cursor-pointer"
            >
              <Anchor className="h-4 w-4" />
              [E] Sali sulla Zattera
            </button>
          )}
          {localPlayer?.mode === 'piloting' && (
            <button
              type="button"
              onClick={onInteract}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-lg hover:bg-slate-700 cursor-pointer"
            >
              [E] Scendi dalla Zattera
            </button>
          )}
          {prompts.nearDepositZone && (
            <button
              type="button"
              onClick={onDeposit}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/50 bg-emerald-500 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-lg hover:bg-emerald-400 cursor-pointer"
            >
              [G] Scarica Cubi in Banca
            </button>
          )}
        </div>

        {/* Collapse Toggle */}
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="pointer-events-auto inline-flex items-center gap-1 rounded-t-lg border border-b-0 border-white/15 bg-slate-900/90 px-3 py-1 text-[11px] font-semibold text-slate-300 hover:text-white cursor-pointer"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" /> Mostra Controlli
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" /> Nascondi Controlli
            </>
          )}
        </button>

        {/* Unified Bottom Dock */}
        {!dockCollapsed && (
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-white/15 bg-slate-900/92 px-4 py-2.5 shadow-2xl max-w-[94vw]">
            {/* Raft or Backpack Cargo Readout */}
            {localPlayer?.mode === 'piloting' && activeRaft ? (
              <div className="flex items-center gap-3 pr-3 border-r border-white/10">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                    {activeRaft.name} (Lv.{activeRaft.level})
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold text-white tabular-nums">
                    <span>
                      Stiva: {activeRaft.cargo.length} / {activeRaft.capacity}
                    </span>
                    <span className="inline-flex items-center gap-1 text-emerald-400">
                      <Heart className="h-3 w-3" /> {activeRaft.hp}/{activeRaft.maxHp}
                    </span>
                  </div>
                </div>
                {activeRaft.cargo.length >= activeRaft.capacity && (
                  <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                    STIVA PIENA
                  </span>
                )}
                <button
                  type="button"
                  onClick={onRepairRaft}
                  disabled={(localProgress?.repairKits || 0) <= 0 || activeRaft.hp >= activeRaft.maxHp}
                  title="Usa Kit Riparazione [R]"
                  className="rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 tabular-nums cursor-pointer"
                >
                  [R] Ripara ({localProgress?.repairKits || 0})
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 pr-3 border-r border-white/10 text-xs tabular-nums">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Zaino Nuoto</div>
                  <div className="font-bold text-white">
                    {localPlayer?.carriedCubes.length || 0} / {backpackCap} Cubi
                  </div>
                </div>
                {activeRaft && (
                  <div className="pl-2 text-[11px] text-cyan-300">
                    Zattera: {activeRaft.cargo.length}/{activeRaft.capacity}
                  </div>
                )}
              </div>
            )}

            {/* Tool Selector */}
            <div className="flex items-center gap-1.5 pr-3 border-r border-white/10">
              {TOOL_LABELS.map((t) => {
                const unlocked = isToolUnlocked(t.id);
                const active = localProgress?.activeTool === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!unlocked}
                    onClick={() => onSelectTool(t.id)}
                    title={unlocked ? `${t.name} [${t.keyHint}]` : `${t.name} (Sblocca nel Fabbricatore)`}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
                      active
                        ? 'bg-cyan-500 text-slate-950'
                        : unlocked
                          ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                          : 'bg-slate-950 text-slate-600 cursor-not-allowed'
                    }`}
                  >
                    <span className="opacity-70 mr-1">{t.keyHint}</span>
                    {t.name}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={onUseTool}
                title="Clicca sull'acqua o premi Spazio per lanciare l'attrezzo"
                className="ml-1 inline-flex items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1.5 text-[11px] font-bold text-amber-300 hover:bg-amber-500/30 cursor-pointer"
              >
                <Wrench className="h-3 w-3" />
                [Spazio / Click] Lancia
              </button>
            </div>

            {/* Fabricator, Camera & Sound */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenFabricator}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 cursor-pointer"
              >
                <Hammer className="h-3.5 w-3.5" />
                [F] Fabbricatore
              </button>
              <button
                type="button"
                onClick={() => onZoom(-0.15)}
                title="Zoom Avanti"
                className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onZoom(0.15)}
                title="Zoom Indietro"
                className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onToggleMute}
                title="Audio [M]"
                className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                {muted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4 text-emerald-400" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
