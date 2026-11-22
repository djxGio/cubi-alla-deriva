import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { Compass, LogIn, LogOut, Play, Plus, User as UserIcon, Users } from 'lucide-react';
import type { RoomSnapshot } from '../shared/gameCatalog';
import gameLogoImg from '../assets/images/cubi_deriva_logo_1795286876893.jpg';

type MenuMode = 'single' | 'multi';

interface LobbyOverlayProps {
  user: User | null;
  authReady: boolean;
  savedRooms: RoomSnapshot[];
  loading: boolean;
  errorMsg: string | null;
  onGoogleSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onCreateRoom: (islandName: string) => Promise<void>;
  onJoinRoom: (roomCode: string) => Promise<void>;
  onQuickGuestPlay: (roomCode?: string, islandName?: string) => void;
}

export const LobbyOverlay: React.FC<LobbyOverlayProps> = ({
  user,
  authReady,
  savedRooms,
  loading,
  errorMsg,
  onGoogleSignIn,
  onSignOut,
  onCreateRoom,
  onJoinRoom,
  onQuickGuestPlay,
}) => {
  const [mode, setMode] = useState<MenuMode>('single');
  const [soloIslandName, setSoloIslandName] = useState('La Mia Isola');
  const [coopIslandName, setCoopIslandName] = useState('Baia dei Cubi');
  const [joinCode, setJoinCode] = useState('');
  const [logoFailed, setLogoFailed] = useState(false);

  const handleStartSingle = () => {
    const cleanName = soloIslandName.trim() || 'La Mia Isola';
    if (user) {
      void onCreateRoom(cleanName);
    } else {
      onQuickGuestPlay(undefined, cleanName);
    }
  };

  const handleCreateMulti = () => {
    const cleanName = coopIslandName.trim() || 'Baia dei Cubi';
    if (user) {
      void onCreateRoom(cleanName);
    } else {
      onQuickGuestPlay(undefined, cleanName);
    }
  };

  const handleJoinMulti = () => {
    const cleanCode = joinCode.trim().toUpperCase();
    if (!cleanCode) return;
    if (user) {
      void onJoinRoom(cleanCode);
    } else {
      onQuickGuestPlay(cleanCode);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-between pointer-events-none">
      {/* Subtle top-and-bottom edge scrims keeping the spinning 3D island 100% open in the center */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-56 bg-gradient-to-b from-slate-950/80 via-slate-950/35 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 h-72 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-transparent"
      />

      {/* Top Section: Account Bar (Right) + Large Centered Hero Title */}
      <div className="relative z-10 flex flex-col items-center px-5 pt-5 sm:px-8 sm:pt-7">
        {/* Top-right Cloud Account Control */}
        <div className="w-full flex justify-end">

          {!authReady ? (
            <div className="pointer-events-auto rounded-xl border border-white/15 bg-slate-900/88 px-3.5 py-2 text-xs text-slate-300">
              Connessione cloud...
            </div>
          ) : user ? (
            <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/15 bg-slate-900/90 px-3.5 py-2 shadow-xl">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Avatar'}
                  className="h-8 w-8 rounded-full border border-amber-400/50 object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 font-bold text-slate-950">
                  {(user.displayName || 'E')[0]}
                </div>
              )}
              <div className="text-xs leading-tight">
                <div className="font-semibold text-white whitespace-nowrap">{user.displayName || 'Esploratore'}</div>
                <div className="text-emerald-400 whitespace-nowrap">Salvataggio Cloud Attivo</div>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                title="Esci dall'account"
                className="ml-1 rounded-lg bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={onGoogleSignIn}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-xl border border-white/15 bg-slate-900/90 px-4 py-2 text-xs font-semibold text-white shadow-xl hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <LogIn className="h-3.5 w-3.5 text-amber-400" />
              Accedi con Google (Cloud)
            </button>
          )}
        </div>

        {/* Large Centered Game Title & Logo over the live spinning island */}
        <header className="mt-1 sm:mt-2 text-center max-w-4xl">
          <div className="inline-flex flex-col sm:flex-row items-center justify-center gap-3.5 sm:gap-5">
            {!logoFailed ? (
              <img
                src={gameLogoImg}
                alt="Logo di Cubi alla Deriva"
                referrerPolicy="no-referrer"
                onError={() => setLogoFailed(true)}
                className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl border border-amber-300/35 bg-slate-900 object-cover shadow-2xl shrink-0"
              />
            ) : (
              <svg width="64" height="64" viewBox="0 0 42 42" fill="none" aria-hidden="true" className="shrink-0 drop-shadow-lg">
                <rect x="4" y="8" width="18" height="18" rx="4" fill="#22d3ee" />
                <rect x="19" y="15" width="19" height="19" rx="4" fill="#f59e0b" fillOpacity="0.95" />
                <path d="M5 35C11 32 17 37 23 34C29 31 33 36 38 34" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            )}
            <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white text-balance drop-shadow-[0_6px_28px_rgba(2,6,23,0.85)]">
              Cubi alla Deriva
            </h1>
          </div>
          <p className="mt-2 text-sm sm:text-base font-medium text-slate-100 drop-shadow-[0_2px_10px_rgba(2,6,23,0.9)]">
            Sopravvivenza 3D sull’isola · Fabbricatore &amp; Zattere · Esplorazione in Mare Aperto
          </p>
        </header>
      </div>

      {/* Bottom Compact 2-Mode Menu Dock */}
      <div className="relative z-10 px-4 pb-5 sm:px-8 sm:pb-7">
        <div className="pointer-events-auto mx-auto w-full max-w-3xl rounded-2xl border border-white/15 bg-slate-900/92 p-4 sm:p-5 shadow-2xl">
          {errorMsg && (
            <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-950/75 px-4 py-2 text-xs font-medium text-rose-200">
              {errorMsg}
            </div>
          )}

          {/* Mode Selector Tabs: Giocatore Singolo | Multigiocatore */}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-950/90 p-1.5 border border-white/10">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'single'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <UserIcon className="h-4 w-4 shrink-0" />
              Giocatore Singolo
            </button>
            <button
              type="button"
              onClick={() => setMode('multi')}
              className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'multi'
                  ? 'bg-cyan-500 text-slate-950 shadow-md'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <Users className="h-4 w-4 shrink-0" />
              Multigiocatore
            </button>
          </div>

          {/* Active Mode Panel */}
          {mode === 'single' ? (
            <div className="mt-4 grid gap-4 md:grid-cols-12 items-end">
              <div className={user && savedRooms.length > 0 ? 'md:col-span-7' : 'md:col-span-12'}>
                <label className="block text-xs font-semibold text-slate-300">
                  Nome della tua isola in solitaria
                </label>
                <div className="mt-2 flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={soloIslandName}
                    onChange={(e) => setSoloIslandName(e.target.value)}
                    maxLength={40}
                    placeholder="La Mia Isola"
                    className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleStartSingle}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-extrabold text-slate-950 shadow-lg hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    {loading ? 'Avvio...' : 'Gioca in Solitaria'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {user
                    ? 'I progressi della tua isola verranno salvati automaticamente sul tuo account Cloud.'
                    : 'Partita immediata da solo. Accedi con Google in alto a destra se vuoi salvare su Cloud.'}
                </p>
              </div>

              {user && savedRooms.length > 0 && (
                <div className="md:col-span-5 border-t md:border-t-0 md:border-l border-white/10 pt-3 md:pt-0 md:pl-4">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                    <Compass className="h-3.5 w-3.5" />
                    Riprendi Isola Salvata ({savedRooms.length})
                  </div>
                  <div className="mt-2 space-y-1.5 max-h-24 overflow-y-auto pr-1">
                    {savedRooms.map((rm) => (
                      <button
                        key={rm.roomCode}
                        type="button"
                        disabled={loading}
                        onClick={() => onJoinRoom(rm.roomCode)}
                        className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-slate-950/85 px-3 py-1.5 text-left text-xs hover:border-amber-400/60 cursor-pointer"
                      >
                        <div className="truncate pr-2">
                          <div className="font-semibold text-white truncate">{rm.name}</div>
                          <div className="text-[11px] text-slate-400 tabular-nums">
                            Isola Lv.{rm.islandLevel} · {rm.rafts.length} Zattere
                          </div>
                        </div>
                        <span className="shrink-0 font-bold text-amber-400 tabular-nums">{rm.bankCubes} ■</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {/* Create Coop Room */}
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                  <Plus className="h-4 w-4" />
                  Crea Stanza Cooperativa
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={coopIslandName}
                    onChange={(e) => setCoopIslandName(e.target.value)}
                    maxLength={40}
                    placeholder="Nome dell'isola"
                    className="w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleCreateMulti}
                    className="shrink-0 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-extrabold text-slate-950 hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    {loading ? 'Creazione...' : 'Crea Stanza'}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Genera un codice invito da condividere con i tuoi amici.
                </p>
              </div>

              {/* Join Coop Room */}
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-400">
                  <Users className="h-4 w-4" />
                  Unisciti con Codice Invito
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    maxLength={16}
                    placeholder="es. ISOLA-4829"
                    className="w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-xs uppercase tracking-wider text-white placeholder:normal-case placeholder:tracking-normal focus:border-cyan-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={loading || joinCode.trim().length < 4}
                    onClick={handleJoinMulti}
                    className="shrink-0 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-extrabold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    Entra
                  </button>
                </div>
                {user && savedRooms.length > 0 ? (
                  <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
                    <span className="text-[11px] text-slate-400 shrink-0">Recenti:</span>
                    {savedRooms.slice(0, 3).map((rm) => (
                      <button
                        key={rm.roomCode}
                        type="button"
                        disabled={loading}
                        onClick={() => onJoinRoom(rm.roomCode)}
                        className="shrink-0 rounded-md border border-white/10 bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 hover:border-emerald-400/60 tabular-nums cursor-pointer"
                      >
                        {rm.name} ({rm.roomCode})
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    Inserisci il codice condiviso da un altro giocatore.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
