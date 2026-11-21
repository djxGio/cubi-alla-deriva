import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  auth,
  createIslandRoom,
  fetchUserRooms,
  generateRoomCode,
  joinIslandRoomByCode,
  saveRoomSnapshotToCloud,
  signInWithGoogle,
  signOutUser,
} from './firebase';
import { WorldEngine, type WorldHudPrompts } from './game/WorldEngine';
import { soundEngine } from './game/soundEngine';
import {
  createDefaultRoomSnapshot,
  createInitialPlayerProgress,
  type GameEventToast,
  type LiveWorldState,
  type RoomSnapshot,
  type ToolId,
} from './shared/gameCatalog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LobbyOverlay } from './components/LobbyOverlay';
import { GameHud } from './components/GameHud';
import { FabricatorModal } from './components/FabricatorModal';

function GameApp() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputTimerRef = useRef<number | null>(null);
  const userRef = useRef<User | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [savedRooms, setSavedRooms] = useState<RoomSnapshot[]>([]);
  const [lobbyLoading, setLobbyLoading] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);

  const [inGame, setInGame] = useState(false);
  const [localUid, setLocalUid] = useState('');
  const [worldState, setWorldState] = useState<LiveWorldState | null>(null);
  const [fabricatorOpen, setFabricatorOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hasCastTool, setHasCastTool] = useState(false);
  const [toasts, setToasts] = useState<GameEventToast[]>([]);
  const [prompts, setPrompts] = useState<WorldHudPrompts>({
    nearRaftId: null,
    nearFabricator: false,
    nearBed: false,
    nearDepositZone: false,
    distanceFromIsland: 0,
    inStorm: false,
  });

  const fabricatorOpenRef = useRef(false);
  fabricatorOpenRef.current = fabricatorOpen;
  const pauseOpenRef = useRef(false);
  pauseOpenRef.current = pauseOpen;
  const promptsRef = useRef(prompts);
  promptsRef.current = prompts;

  const pushToast = useCallback((toast: GameEventToast) => {
    setToasts((prev) => [...prev.slice(-3), toast]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 3600);
  }, []);

  const sendWs = useCallback((type: string, payload?: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }, []);

  // 1. Mount isolated Three.js canvas once
  useEffect(() => {
    if (!canvasMountRef.current) return;
    const engine = new WorldEngine(
      canvasMountRef.current,
      (nextPrompts) => {
        setPrompts(nextPrompts);
      },
      (targetX, targetZ) => {
        if (fabricatorOpenRef.current || pauseOpenRef.current) return;
        sendWs('player:action', { action: 'use_tool', targetX, targetZ });
      }
    );
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [sendWs]);

  // 2. Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      userRef.current = u;
      setAuthReady(true);
      if (u) {
        try {
          const rooms = await fetchUserRooms(u.uid);
          setSavedRooms(rooms);
        } catch {
          setSavedRooms([]);
        }
      } else {
        setSavedRooms([]);
      }
    });
    return () => unsub();
  }, []);

  const leaveCurrentRoom = useCallback(() => {
    if (inputTimerRef.current) {
      clearInterval(inputTimerRef.current);
      inputTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (engineRef.current) {
      engineRef.current.isTitleMode = true;
    }
    setInGame(false);
    setFabricatorOpen(false);
    setPauseOpen(false);
    setHasCastTool(false);
    setWorldState(null);
  }, []);

  const connectToRoom = useCallback(
    (snapshot: RoomSnapshot, uid: string, displayName: string) => {
      leaveCurrentRoom();

      setLocalUid(uid);
      if (engineRef.current) {
        engineRef.current.setLocalUid(uid);
        engineRef.current.isTitleMode = false;
      }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'room:join',
            payload: {
              roomCode: snapshot.roomCode,
              uid,
              displayName,
              initialSnapshot: snapshot,
            },
          })
        );
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'room:init') {
            const full: LiveWorldState = msg.payload;
            engineRef.current?.applyFullState(full);
            setWorldState(full);
            setInGame(true);
          } else if (msg.type === 'room:sync') {
            const snap: RoomSnapshot = msg.payload;
            engineRef.current?.applySnapshotUpdate(snap);
            setWorldState((prev) => (prev ? { ...prev, ...snap } : prev));
          } else if (msg.type === 'room:tick') {
            engineRef.current?.applyTick(msg.payload);
            setWorldState((prev) =>
              prev
                ? {
                    ...prev,
                    players: msg.payload.players,
                    storms: msg.payload.storms,
                    weather: msg.payload.weather ?? prev.weather,
                    dayState: msg.payload.dayState ?? prev.dayState,
                    sharks: prev.sharks.map((s) => {
                      const updated = msg.payload.sharks.find((u: any) => u.id === s.id);
                      return updated ? { ...s, ...updated } : s;
                    }),
                    rafts: prev.rafts.map((r) => {
                      const updated = msg.payload.rafts.find((u: any) => u.id === r.id);
                      return updated ? { ...r, ...updated } : r;
                    }),
                  }
                : prev
            );
          } else if (msg.type === 'room:pickup') {
            soundEngine.playPickup(msg.payload.tier);
            engineRef.current?.spawnBurst(msg.payload.x, 0.8, msg.payload.z, '#22d3ee', 12);
          } else if (msg.type === 'room:tool_cast') {
            const t: ToolId = msg.payload.tool;
            setHasCastTool(true);
            soundEngine.playToolPulse(
              t === 'solar_lance' ? 'solar' : t === 'harpoon' ? 'harpoon' : 'magnet'
            );
            engineRef.current?.spawnToolCast(msg.payload);
          } else if (msg.type === 'room:tool_pulse') {
            const t: ToolId = msg.payload.tool;
            soundEngine.playToolPulse(
              t === 'solar_lance' ? 'solar' : t === 'harpoon' ? 'harpoon' : 'magnet'
            );
            engineRef.current?.spawnToolPulse(msg.payload.x, msg.payload.z, msg.payload.radius, t);
          } else if (msg.type === 'room:harvester_beam') {
            engineRef.current?.spawnHarvesterBeam(msg.payload.x, msg.payload.z);
          } else if (msg.type === 'room:impact') {
            soundEngine.playImpact();
            engineRef.current?.triggerShake(0.65);
            engineRef.current?.spawnBurst(msg.payload.x, 1.0, msg.payload.z, '#ef4444', 18);
          } else if (msg.type === 'room:toast') {
            const toast: GameEventToast = msg.payload;
            if (toast.type === 'deposit') soundEngine.playDeposit();
            else if (toast.type === 'craft') soundEngine.playCraft();
            else if (toast.type === 'levelup') soundEngine.playLevelUp();
            pushToast(toast);
          } else if (msg.type === 'room:error') {
            pushToast({
              id: String(Date.now()),
              type: 'warning',
              message: String(msg.payload),
              color: '#f43f5e',
            });
          } else if (msg.type === 'room:persist') {
            if (userRef.current) {
              saveRoomSnapshotToCloud(msg.payload).catch((err) =>
                console.error('Cloud save failed:', err)
              );
            }
          }
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      // Send local input vector at 20 Hz
      inputTimerRef.current = window.setInterval(() => {
        if (!engineRef.current || fabricatorOpenRef.current) {
          sendWs('player:input', { moveX: 0, moveZ: 0, sprint: false });
          return;
        }
        const vec = engineRef.current.getInputVector();
        sendWs('player:input', vec);
      }, 50);
    },
    [leaveCurrentRoom, pushToast, sendWs]
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      leaveCurrentRoom();
    };
  }, [leaveCurrentRoom]);

  // Keyboard shortcuts during gameplay
  useEffect(() => {
    if (!inGame) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat) return;

      if (e.code === 'Escape') {
        if (fabricatorOpenRef.current) setFabricatorOpen(false);
        else setPauseOpen((p) => !p);
        return;
      }
      if (e.code === 'KeyF') {
        setFabricatorOpen((v) => !v);
        return;
      }
      if (e.code === 'KeyM') {
        const next = !soundEngine.isMuted();
        soundEngine.setMuted(next);
        setMuted(next);
        return;
      }
      if (fabricatorOpenRef.current) return;

      if (e.code === 'KeyE') {
        if (promptsRef.current.nearBed && !promptsRef.current.nearRaftId) {
          sendWs('player:action', { action: 'sleep' });
        } else if (promptsRef.current.nearFabricator && !promptsRef.current.nearRaftId) {
          setFabricatorOpen(true);
        } else {
          sendWs('player:action', { action: 'interact' });
        }
      } else if (e.code === 'KeyG') {
        sendWs('player:action', { action: 'deposit' });
      } else if (e.code === 'Space') {
        e.preventDefault();
        const aim = engineRef.current?.getAimPoint();
        sendWs('player:action', { action: 'use_tool', targetX: aim?.x, targetZ: aim?.z });
      } else if (e.code === 'KeyR') {
        sendWs('player:action', { action: 'repair_raft' });
      } else if (e.code === 'Digit1') {
        sendWs('player:select_tool', { tool: 'net' });
      } else if (e.code === 'Digit2') {
        sendWs('player:select_tool', { tool: 'magnet_net' });
      } else if (e.code === 'Digit3') {
        sendWs('player:select_tool', { tool: 'harpoon' });
      } else if (e.code === 'Digit4') {
        sendWs('player:select_tool', { tool: 'solar_lance' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inGame, sendWs]);

  const handleGoogleSignIn = async () => {
    setLobbyLoading(true);
    setLobbyError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setLobbyError(err?.message || 'Accesso Google annullato.');
    } finally {
      setLobbyLoading(false);
    }
  };

  const handleCreateRoom = async (islandName: string) => {
    if (!user) return;
    setLobbyLoading(true);
    setLobbyError(null);
    try {
      const snap = await createIslandRoom(user, islandName);
      setSavedRooms((prev) => [snap, ...prev]);
      connectToRoom(snap, user.uid, user.displayName || 'Esploratore');
    } catch (err: any) {
      setLobbyError(err?.message || 'Errore nella creazione della stanza.');
    } finally {
      setLobbyLoading(false);
    }
  };

  const handleJoinRoom = async (roomCode: string) => {
    if (!user) return;
    setLobbyLoading(true);
    setLobbyError(null);
    try {
      const snap = await joinIslandRoomByCode(user, roomCode);
      connectToRoom(snap, user.uid, user.displayName || 'Esploratore');
    } catch (err: any) {
      setLobbyError(err?.message || 'Impossibile entrare nella stanza.');
    } finally {
      setLobbyLoading(false);
    }
  };

  const handleQuickGuestPlay = (roomCode?: string, islandName?: string) => {
    const uid = `guest-${Math.random().toString(36).slice(2, 8)}`;
    const code = roomCode ? roomCode.toUpperCase() : generateRoomCode();
    const snap = createDefaultRoomSnapshot(code, islandName || 'Isola Rapida', uid, 'Marinaio');
    connectToRoom(snap, uid, 'Marinaio');
  };

  const localProgress =
    (worldState && worldState.playerProgress[localUid]) ||
    createInitialPlayerProgress(localUid || 'local', 'Esploratore');

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
      {/* Isolated WebGL Canvas Container */}
      <div ref={canvasMountRef} className="fixed inset-0 z-0" />

      {!inGame && (
        <LobbyOverlay
          user={user}
          authReady={authReady}
          savedRooms={savedRooms}
          loading={lobbyLoading}
          errorMsg={lobbyError}
          onGoogleSignIn={handleGoogleSignIn}
          onSignOut={signOutUser}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onQuickGuestPlay={handleQuickGuestPlay}
        />
      )}

      {inGame && worldState && (
        <>
          <GameHud
            worldState={worldState}
            localUid={localUid}
            prompts={prompts}
            toasts={toasts}
            muted={muted}
            hasCastTool={hasCastTool}
            onToggleMute={() => {
              const next = !muted;
              soundEngine.setMuted(next);
              setMuted(next);
            }}
            onOpenFabricator={() => setFabricatorOpen(true)}
            onSleep={() => sendWs('player:action', { action: 'sleep' })}
            onInteract={() => sendWs('player:action', { action: 'interact' })}
            onDeposit={() => sendWs('player:action', { action: 'deposit' })}
            onUseTool={() => {
              const aim = engineRef.current?.getAimPoint();
              sendWs('player:action', { action: 'use_tool', targetX: aim?.x, targetZ: aim?.z });
            }}
            onRepairRaft={() => sendWs('player:action', { action: 'repair_raft' })}
            onSelectTool={(tool) => sendWs('player:select_tool', { tool })}
            onZoom={(d) => engineRef.current?.adjustZoom(d)}
            onLeaveRoom={leaveCurrentRoom}
          />

          <FabricatorModal
            open={fabricatorOpen}
            onClose={() => setFabricatorOpen(false)}
            worldState={worldState}
            localProgress={localProgress}
            onCraft={(recipeId, raftId) => sendWs('craft:execute', { recipeId, raftId })}
          />

          {pauseOpen && (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4">
              <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-slate-900 p-6 shadow-2xl text-center">
                <h2 className="font-display text-xl font-bold text-white">Pausa · {worldState.name}</h2>
                <p className="mt-2 text-xs text-slate-300">
                  Codice Invito Stanza: <strong className="text-cyan-300">{worldState.roomCode}</strong>
                </p>
                <div className="mt-4 rounded-xl bg-slate-950/70 p-3 text-left text-xs text-slate-300 space-y-1">
                  <div><strong>WASD / Frecce:</strong> Muovi personaggio o zattera</div>
                  <div><strong>Q / C:</strong> Ruota telecamera · <strong>Rotella:</strong> Zoom</div>
                  <div><strong>E:</strong> Sali/Scendi zattera o Apri Fabbricatore</div>
                  <div><strong>Click sull’acqua / Spazio:</strong> Lancia Retino, Arpione o Lancia</div>
                  <div><strong>F:</strong> Apri Fabbricatore · <strong>R:</strong> Ripara zattera</div>
                </div>
                <div className="mt-5 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setPauseOpen(false)}
                    className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400 cursor-pointer"
                  >
                    Riprendi
                  </button>
                  <button
                    type="button"
                    onClick={leaveCurrentRoom}
                    className="flex-1 rounded-xl bg-slate-800 py-2.5 text-sm font-bold text-slate-200 hover:bg-slate-700 cursor-pointer"
                  >
                    Esci al Menu
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <GameApp />
    </ErrorBoundary>
  );
}
