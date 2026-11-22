import 'dotenv/config';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI } from '@google/genai';
import {
  CUBE_CONFIG,
  MARKET_ITEMS,
  MAX_BREATH_SECONDS,
  MAX_HUNGER,
  RECIPES,
  computeRecipeCost,
  createDefaultRoomSnapshot,
  createInitialPlayerProgress,
  createInitialRaft,
  getBackpackCapacity,
  getBedPosition,
  getIslandRadius,
  getMarketPosition,
  getPlayerLevelFromXp,
  getRaftBuildSpec,
  getRaftCapacity,
  getRefineryMultiplier,
  getSyncedWaveTime,
  getWalkableSurfaceHeight,
  getWaveHeight,
  type CubeTier,
  type GameEventToast,
  type LivePlayerState,
  type LiveWorldState,
  type MarketItemId,
  type RoomSnapshot,
  type SharkEntity,
  type StormCell,
  type ToolId,
  type WeatherPhase,
  type WorldCube,
} from './src/shared/gameCatalog.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

interface ClientInput {
  moveX: number;
  moveZ: number;
  sprint: boolean;
}

interface ConnectedClient {
  ws: WebSocket;
  uid: string;
  roomCode: string;
  input: ClientInput;
}

class RoomSimulation {
  public state: LiveWorldState;
  public clients = new Map<string, ConnectedClient>();
  private cubeSeq = 1;
  private harvesterAcc = 0;
  private nightCubeSurgeAcc = 0;
  private wasNightPhase = false;
  private cubesDirty = true;
  private weatherTimer = 45;
  private hungerWarned = new Set<string>();
  private starvationWarned = new Set<string>();
  private starvationImpactAcc = new Map<string, number>();
  private hungerSaturation = new Map<string, number>();
  private hungerExhaustion = new Map<string, number>();

  constructor(snapshot: RoomSnapshot) {
    this.state = {
      ...snapshot,
      players: {},
      worldCubes: [],
      sharks: this.createInitialSharks(),
      storms: this.createInitialStorms(),
      weather: {
        phase: 'sunny',
        intensity: 0,
        nextChangeInSec: 45,
      },
      dayState: {
        day: 1,
        timeOfDay: 0.14,
        cycleDurationSec: 90,
      },
      serverTime: Date.now(),
    };
    this.regenerateDailyCubes(true);
  }

  private createInitialSharks(): SharkEntity[] {
    const sharks: SharkEntity[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const dist = 68 + (i % 3) * 44;
      sharks.push({
        id: `shark-${i + 1}`,
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
        angle: angle + Math.PI / 2,
        state: 'patrol',
        stunTimer: 0,
        targetRaftId: null,
      });
    }
    return sharks;
  }

  private createInitialStorms(): StormCell[] {
    return [
      { id: 'storm-1', x: 135, z: 40, radius: 34, intensity: 0.9 },
      { id: 'storm-2', x: -115, z: -95, radius: 38, intensity: 1.0 },
      { id: 'storm-3', x: 25, z: -155, radius: 32, intensity: 0.85 },
    ];
  }

  private getNightFactor(): number {
    const tod = this.state.dayState.timeOfDay;
    if (tod >= 0.78 && tod <= 0.95) return 1;
    if (tod > 0.62 && tod < 0.78) return (tod - 0.62) / 0.16;
    if (tod > 0.95) return 1 - (tod - 0.95) / 0.05;
    if (tod < 0.08) return Math.max(0, (0.08 - tod) / 0.08 * 0.35);
    return 0;
  }

  private pickCubeTier(): CubeTier {
    const lh = this.state.structures.lighthouseLevel;
    const nightBoost = this.getNightFactor();
    const roll = Math.random();
    const solarChance = 0.08 + lh * 0.02 + nightBoost * 0.04;
    const epicChance = 0.18 + lh * 0.03 + nightBoost * 0.07;
    const rareChance = 0.34 + lh * 0.02 + nightBoost * 0.06;
    if (roll < solarChance) return 'solar';
    if (roll < solarChance + epicChance) return 'epic';
    if (roll < solarChance + epicChance + rareChance) return 'rare';
    return 'base';
  }

  private spawnNearIslandCube(): WorldCube {
    const tier: CubeTier = Math.random() < 0.22 ? 'rare' : 'base';
    const cfg = CUBE_CONFIG[tier];
    const islandR = getIslandRadius(this.state.islandLevel);
    const minDist = islandR + 2.4;
    const maxDist = islandR + 13.5;
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * (maxDist - minDist);
    return {
      id: `c-${this.cubeSeq++}`,
      x: Number((Math.cos(angle) * dist).toFixed(2)),
      z: Number((Math.sin(angle) * dist).toFixed(2)),
      tier,
      value: cfg.value,
      xp: cfg.xp,
    };
  }

  private spawnCube(): WorldCube {
    const tier = this.pickCubeTier();
    const cfg = CUBE_CONFIG[tier];
    const minDist = Math.max(cfg.minDist, getIslandRadius(this.state.islandLevel) + 3.5);
    const maxDist = Math.max(minDist + 15, cfg.maxDist);
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * (maxDist - minDist);
    return {
      id: `c-${this.cubeSeq++}`,
      x: Number((Math.cos(angle) * dist).toFixed(2)),
      z: Number((Math.sin(angle) * dist).toFixed(2)),
      tier,
      value: cfg.value,
      xp: cfg.xp,
    };
  }

  private regenerateDailyCubes(silent = false) {
    const fresh: WorldCube[] = [];
    // Guaranteed near-island cubes around the shoreline every new day
    const nearShoreCount = 16;
    for (let i = 0; i < nearShoreCount; i++) {
      fresh.push(this.spawnNearIslandCube());
    }
    // Randomized open-sea cubes across all tiers
    const targetCount = 94;
    while (fresh.length < targetCount) {
      fresh.push(this.spawnCube());
    }
    this.state.worldCubes = fresh;
    this.cubesDirty = true;
    if (!silent) {
      this.emitToast({
        type: 'pickup',
        message: `Giorno ${this.state.dayState.day}: i cubi si sono rigenerati in nuove posizioni attorno all'isola e al largo!`,
        color: '#fbbf24',
      });
    }
  }

  private refillCubes() {
    const islandR = getIslandRadius(this.state.islandLevel);
    const nightFactor = this.getNightFactor();
    const minNearCount = nightFactor > 0.5 ? 8 : 6;
    let nearCount = 0;
    for (const c of this.state.worldCubes) {
      if (Math.hypot(c.x, c.z) <= islandR + 14.5) nearCount++;
    }
    while (nearCount < minNearCount) {
      this.state.worldCubes.push(this.spawnNearIslandCube());
      nearCount++;
      this.cubesDirty = true;
    }
    const targetCount = Math.round(94 + nightFactor * 18);
    while (this.state.worldCubes.length < targetCount) {
      this.state.worldCubes.push(this.spawnCube());
      this.cubesDirty = true;
    }
  }

  public addOrUpdatePlayer(uid: string, displayName: string, ws: WebSocket) {
    if (!this.state.memberUids.includes(uid)) {
      this.state.memberUids.push(uid);
    }
    if (!this.state.playerProgress[uid]) {
      const idx = Object.keys(this.state.playerProgress).length;
      this.state.playerProgress[uid] = createInitialPlayerProgress(uid, displayName, idx);
    } else {
      if (displayName) {
        this.state.playerProgress[uid].displayName = displayName;
      }
      if (typeof this.state.playerProgress[uid].potions !== 'number') {
        this.state.playerProgress[uid].potions = 0;
      }
      if (typeof this.state.playerProgress[uid].food !== 'number') {
        this.state.playerProgress[uid].food = 0;
      }
    }
    const progress = this.state.playerProgress[uid];

    const existingPlayer = this.state.players[uid];
    if (!existingPlayer) {
      const spawnAngle = (Object.keys(this.state.players).length * 1.1) % (Math.PI * 2);
      const spawnR = Math.max(3.5, getIslandRadius(this.state.islandLevel) * 0.45);
      this.state.players[uid] = {
        uid,
        displayName: progress.displayName,
        color: progress.color,
        x: Math.cos(spawnAngle) * spawnR,
        y: 1.1,
        z: Math.sin(spawnAngle) * spawnR,
        angle: 0,
        mode: 'walking',
        pilotingRaftId: null,
        carriedCubes: [],
        hp: 100,
        maxHp: 100,
        hunger: MAX_HUNGER,
        maxHunger: MAX_HUNGER,
        activeTool: progress.activeTool,
        toolCooldown: 0,
        lastToolPulseAt: 0,
        breath: MAX_BREATH_SECONDS,
        maxBreath: MAX_BREATH_SECONDS,
      };
      this.hungerSaturation.set(uid, 25);
      this.hungerExhaustion.set(uid, 0);
    }

    this.clients.set(uid, {
      ws,
      uid,
      roomCode: this.state.roomCode,
      input: { moveX: 0, moveZ: 0, sprint: false },
    });
  }

  public removeClient(uid: string) {
    this.clients.delete(uid);
    const p = this.state.players[uid];
    if (p && p.pilotingRaftId) {
      const raft = this.state.rafts.find((r) => r.id === p.pilotingRaftId);
      if (raft && raft.pilotUid === uid) {
        raft.pilotUid = null;
      }
      p.pilotingRaftId = null;
      p.mode = 'walking';
    }
    delete this.state.players[uid];
    this.hungerSaturation.delete(uid);
    this.hungerExhaustion.delete(uid);
    this.hungerWarned.delete(uid);
    this.starvationWarned.delete(uid);
    this.starvationImpactAcc.delete(uid);
  }

  public getSnapshot(): RoomSnapshot {
    return {
      roomCode: this.state.roomCode,
      name: this.state.name,
      hostUid: this.state.hostUid,
      memberUids: [...this.state.memberUids],
      bankCubes: this.state.bankCubes,
      islandLevel: this.state.islandLevel,
      structures: { ...this.state.structures },
      rafts: this.state.rafts.map((r) => ({ ...r, cargo: [...r.cargo] })),
      playerProgress: structuredClone(this.state.playerProgress),
    };
  }

  public broadcast(type: string, payload: unknown) {
    const msg = JSON.stringify({ type, payload });
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }

  private sendTo(uid: string, type: string, payload: unknown) {
    const client = this.clients.get(uid);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ type, payload }));
    }
  }

  private emitToast(toast: Omit<GameEventToast, 'id'>) {
    this.broadcast('room:toast', {
      ...toast,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });
  }

  private awardXp(uid: string, amount: number) {
    const prog = this.state.playerProgress[uid];
    if (!prog || amount <= 0) return;
    const prevLevel = prog.level;
    prog.xp += Math.round(amount);
    const computed = getPlayerLevelFromXp(prog.xp);
    prog.level = computed.level;
    if (prog.level > prevLevel) {
      this.emitToast({
        type: 'levelup',
        message: `${prog.displayName} è salito al Livello Giocatore ${prog.level}!`,
        color: prog.color,
      });
    }
  }

  private depositCubes(uid: string, tiers: CubeTier[], sourceLabel: string) {
    if (tiers.length === 0) return 0;
    const mult = getRefineryMultiplier(this.state.structures.refineryLevel);
    let rawTotal = 0;
    let xpTotal = 0;
    for (const tier of tiers) {
      rawTotal += CUBE_CONFIG[tier].value;
      xpTotal += Math.round(CUBE_CONFIG[tier].xp * 0.4);
    }
    const gained = Math.max(1, Math.round(rawTotal * mult));
    this.state.bankCubes += gained;
    this.awardXp(uid, xpTotal);
    const prog = this.state.playerProgress[uid];
    const multText = mult > 1 ? ` (x${mult.toFixed(2)} Raffineria)` : '';
    this.emitToast({
      type: 'deposit',
      message: `${prog?.displayName || 'Giocatore'} ha depositato +${gained} cubi da ${sourceLabel}${multText}`,
      color: '#fbbf24',
    });
    this.broadcast('room:persist', this.getSnapshot());
    return gained;
  }

  public handleInteract(uid: string) {
    const player = this.state.players[uid];
    if (!player) return;
    const islandR = getIslandRadius(this.state.islandLevel);
    const dockReach = islandR + 10 + this.state.structures.dockLevel * 3.5;

    // 1. If piloting a raft
    if (player.mode === 'piloting' && player.pilotingRaftId) {
      const raft = this.state.rafts.find((r) => r.id === player.pilotingRaftId);
      if (raft) {
        const dist = Math.hypot(raft.x, raft.z);
        if (dist <= dockReach && raft.cargo.length > 0) {
          const tiers = [...raft.cargo];
          raft.cargo = [];
          this.depositCubes(uid, tiers, raft.name);
        }
        raft.pilotUid = null;
        player.pilotingRaftId = null;
        // Step off towards shore if near island, otherwise swim next to raft
        if (dist <= islandR + 10) {
          const toCenter = Math.atan2(-raft.z, -raft.x);
          player.x = raft.x + Math.cos(toCenter) * 2.2;
          player.z = raft.z + Math.sin(toCenter) * 2.2;
          const surf = getWalkableSurfaceHeight(
            player.x,
            player.z,
            this.state.islandLevel,
            this.state.structures
          );
          player.mode = surf !== null ? 'walking' : 'swimming';
        } else {
          player.x = raft.x + 2.4;
          player.z = raft.z;
          player.mode = 'swimming';
        }
        this.broadcast('room:sync', this.getSnapshot());
      }
      return;
    }

    // 2. If near Fabricator / Island shore and carrying cubes
    const distOrigin = Math.hypot(player.x, player.z);
    if (distOrigin <= islandR + 2 && player.carriedCubes.length > 0) {
      const tiers = [...player.carriedCubes];
      player.carriedCubes = [];
      this.depositCubes(uid, tiers, 'zaino');
      this.broadcast('room:sync', this.getSnapshot());
      return;
    }

    // 3. Board nearest available raft
    let nearestRaft: (typeof this.state.rafts)[0] | null = null;
    let bestDist = 6.5;
    for (const raft of this.state.rafts) {
      if (raft.pilotUid && raft.pilotUid !== uid) continue;
      const d = Math.hypot(raft.x - player.x, raft.z - player.z);
      if (d < bestDist) {
        bestDist = d;
        nearestRaft = raft;
      }
    }
    if (nearestRaft) {
      nearestRaft.pilotUid = uid;
      player.pilotingRaftId = nearestRaft.id;
      player.mode = 'piloting';
      player.x = nearestRaft.x;
      player.z = nearestRaft.z;

      // Transfer carried cubes into raft cargo if space allows
      while (
        player.carriedCubes.length > 0 &&
        nearestRaft.cargo.length < nearestRaft.capacity
      ) {
        const c = player.carriedCubes.pop()!;
        nearestRaft.cargo.push(c);
      }
      this.broadcast('room:sync', this.getSnapshot());
    }
  }

  public handleDepositAction(uid: string) {
    const player = this.state.players[uid];
    if (!player) return;
    const islandR = getIslandRadius(this.state.islandLevel);
    const dockReach = islandR + 11 + this.state.structures.dockLevel * 3.5;

    let depositedAny = false;
    if (player.carriedCubes.length > 0 && Math.hypot(player.x, player.z) <= dockReach) {
      const tiers = [...player.carriedCubes];
      player.carriedCubes = [];
      this.depositCubes(uid, tiers, 'zaino');
      depositedAny = true;
    }
    if (player.pilotingRaftId) {
      const raft = this.state.rafts.find((r) => r.id === player.pilotingRaftId);
      if (raft && raft.cargo.length > 0 && Math.hypot(raft.x, raft.z) <= dockReach) {
        const tiers = [...raft.cargo];
        raft.cargo = [];
        this.depositCubes(uid, tiers, raft.name);
        depositedAny = true;
      }
    }
    if (depositedAny) {
      this.broadcast('room:sync', this.getSnapshot());
    }
  }

  private distToSegment(
    px: number,
    pz: number,
    ax: number,
    az: number,
    bx: number,
    bz: number
  ): number {
    const abx = bx - ax;
    const abz = bz - az;
    const lenSq = abx * abx + abz * abz;
    if (lenSq < 0.0001) return Math.hypot(px - ax, pz - az);
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lenSq));
    const cx = ax + t * abx;
    const cz = az + t * abz;
    return Math.hypot(px - cx, pz - cz);
  }

  public handleUseTool(uid: string, targetX?: number, targetZ?: number) {
    const player = this.state.players[uid];
    const prog = this.state.playerProgress[uid];
    if (!player || !prog || player.toolCooldown > 0) return;

    const tool = player.activeTool;
    let maxRange = 17;
    let catchRadius = 3.2;
    let stunRadius = 0;
    let maxCatchPerCast = 2;

    if (tool === 'magnet_net' && prog.tools.magnetNetLv > 0) {
      maxRange = 23 + prog.tools.magnetNetLv * 3;
      catchRadius = 5.5 + prog.tools.magnetNetLv * 1.4;
      maxCatchPerCast = 5 + prog.tools.magnetNetLv;
      player.toolCooldown = 1.05;
    } else if (tool === 'harpoon' && prog.tools.harpoonLv > 0) {
      maxRange = 28 + prog.tools.harpoonLv * 4;
      catchRadius = 3.8 + prog.tools.harpoonLv * 0.6;
      stunRadius = 11 + prog.tools.harpoonLv * 3;
      maxCatchPerCast = 4;
      player.toolCooldown = 1.25;
    } else if (tool === 'solar_lance' && prog.tools.solarLanceLv > 0) {
      maxRange = 35 + prog.tools.solarLanceLv * 3;
      catchRadius = 7.5 + prog.tools.solarLanceLv * 1.5;
      stunRadius = 16 + prog.tools.solarLanceLv * 3;
      maxCatchPerCast = 10;
      player.toolCooldown = 1.15;
    } else {
      // Base throwable casting net ('net')
      maxRange = 17.5;
      catchRadius = 3.4;
      maxCatchPerCast = 2;
      player.toolCooldown = 0.8;
    }

    // Determine throw direction & landing coordinates
    let dirX = Math.sin(player.angle);
    let dirZ = Math.cos(player.angle);
    let castDist = maxRange * 0.78;
    if (
      typeof targetX === 'number' &&
      typeof targetZ === 'number' &&
      Number.isFinite(targetX) &&
      Number.isFinite(targetZ)
    ) {
      const dx = targetX - player.x;
      const dz = targetZ - player.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.35) {
        dirX = dx / d;
        dirZ = dz / d;
        castDist = Math.min(maxRange, Math.max(3.5, d));
        player.angle = Math.atan2(dirX, dirZ);
      }
    }

    const landX = player.x + dirX * castDist;
    const landZ = player.z + dirZ * castDist;
    player.lastToolPulseAt = Date.now();
    this.hungerExhaustion.set(uid, (this.hungerExhaustion.get(uid) ?? 0) + 0.35);

    // Stun sharks near landing or flight path if harpoon / solar lance
    let stunnedCount = 0;
    if (stunRadius > 0) {
      for (const shark of this.state.sharks) {
        const dLine = this.distToSegment(shark.x, shark.z, player.x, player.z, landX, landZ);
        const dLand = Math.hypot(shark.x - landX, shark.z - landZ);
        if (dLine <= stunRadius * 0.65 || dLand <= stunRadius) {
          shark.state = 'stunned';
          shark.stunTimer = 6.0;
          const pushAngle = Math.atan2(shark.z - player.z, shark.x - player.x);
          shark.x += Math.cos(pushAngle) * 16;
          shark.z += Math.sin(pushAngle) * 16;
          stunnedCount++;
        }
      }
      if (stunnedCount > 0) {
        this.awardXp(uid, stunnedCount * 18);
        this.emitToast({
          type: 'pickup',
          message: `${prog.displayName} ha stordito ${stunnedCount} squalo/i!`,
          color: '#38bdf8',
        });
      }
    }

    // Catch cubes along throw trajectory or inside landing splash zone
    const raft = player.pilotingRaftId
      ? this.state.rafts.find((r) => r.id === player.pilotingRaftId)
      : null;
    const backpackCap = getBackpackCapacity(prog.gear.backpackLv);
    const isStandingOnIsland = player.mode === 'walking';

    const remainingCubes: WorldCube[] = [];
    const caughtCubes: Array<{ x: number; z: number; tier: CubeTier; xp: number }> = [];
    let blockedByFull = false;

    for (const cube of this.state.worldCubes) {
      if (caughtCubes.length < maxCatchPerCast) {
        const dLand = Math.hypot(cube.x - landX, cube.z - landZ);
        const dPath = this.distToSegment(cube.x, cube.z, player.x, player.z, landX, landZ);
        if (dLand <= catchRadius || dPath <= Math.max(1.8, catchRadius * 0.55)) {
          if (raft) {
            if (raft.cargo.length < raft.capacity) {
              raft.cargo.push(cube.tier);
              this.awardXp(uid, cube.xp);
              caughtCubes.push({ x: cube.x, z: cube.z, tier: cube.tier, xp: cube.xp });
              continue;
            } else {
              blockedByFull = true;
            }
          } else if (isStandingOnIsland) {
            caughtCubes.push({ x: cube.x, z: cube.z, tier: cube.tier, xp: cube.xp });
            continue;
          } else {
            if (player.carriedCubes.length < backpackCap) {
              player.carriedCubes.push(cube.tier);
              this.awardXp(uid, cube.xp);
              caughtCubes.push({ x: cube.x, z: cube.z, tier: cube.tier, xp: cube.xp });
              continue;
            } else {
              blockedByFull = true;
            }
          }
        }
      }
      remainingCubes.push(cube);
    }

    if (caughtCubes.length > 0) {
      this.state.worldCubes = remainingCubes;
      this.cubesDirty = true;
      this.refillCubes();

      if (isStandingOnIsland && !raft) {
        this.depositCubes(
          uid,
          caughtCubes.map((c) => c.tier),
          'retino da riva'
        );
      } else {
        this.sendTo(uid, 'room:pickup', {
          tier: caughtCubes[0].tier,
          x: landX,
          z: landZ,
        });
      }

      if (tool === 'solar_lance' && raft && raft.hp < raft.maxHp) {
        raft.hp = Math.min(raft.maxHp, raft.hp + 8);
      }
      this.broadcast('room:sync', this.getSnapshot());
    } else if (blockedByFull) {
      this.sendTo(
        uid,
        'room:error',
        raft
          ? `Stiva della zattera piena (${raft.cargo.length}/${raft.capacity})! Torna all'isola per scaricare.`
          : `Zaino pieno (${player.carriedCubes.length}/${backpackCap})! Torna all'isola per depositare.`
      );
    }

    this.broadcast('room:tool_cast', {
      uid,
      tool,
      fromX: player.x,
      fromZ: player.z,
      toX: landX,
      toZ: landZ,
      radius: catchRadius,
      caughtCubes: caughtCubes.map((c) => ({ x: c.x, z: c.z, tier: c.tier })),
    });
  }

  public handleSelectTool(uid: string, tool: ToolId) {
    const prog = this.state.playerProgress[uid];
    const player = this.state.players[uid];
    if (!prog || !player) return;
    const unlocked =
      tool === 'net' ||
      (tool === 'magnet_net' && prog.tools.magnetNetLv > 0) ||
      (tool === 'harpoon' && prog.tools.harpoonLv > 0) ||
      (tool === 'solar_lance' && prog.tools.solarLanceLv > 0);
    if (!unlocked) return;
    prog.activeTool = tool;
    player.activeTool = tool;
    this.broadcast('room:sync', this.getSnapshot());
  }

  public handleSleep(uid: string) {
    const player = this.state.players[uid];
    const prog = this.state.playerProgress[uid];
    if (!player || !prog || player.mode !== 'walking') return;

    const bedPos = getBedPosition(this.state.islandLevel);
    if (Math.hypot(player.x - bedPos.x, player.z - bedPos.z) > 4.8) {
      this.sendTo(uid, 'room:error', 'Avvicinati al letto sull’isola per dormire.');
      return;
    }

    for (const p of Object.values(this.state.players)) {
      if (p.hunger > 0) {
        p.hp = Math.min(p.maxHp, p.hp + 25);
      }
      p.breath = p.maxBreath;
    }

    this.state.dayState.day += 1;
    this.state.dayState.timeOfDay = 0.14;
    this.wasNightPhase = false;
    this.nightCubeSurgeAcc = 0;
    this.regenerateDailyCubes(true);

    this.emitToast({
      type: 'levelup',
      message: `${prog.displayName} ha dormito nel letto: inizia il Giorno ${this.state.dayState.day}! Cubi rigenerati attorno all'isola e al largo.`,
      color: '#fbbf24',
    });
    this.broadcast('room:sync', this.getSnapshot());
  }

  public handleMarketBuy(uid: string, itemId: MarketItemId, useNow = false) {
    const player = this.state.players[uid];
    const prog = this.state.playerProgress[uid];
    const item = MARKET_ITEMS.find((m) => m.id === itemId);
    if (!player || !prog || !item) return;

    const marketPos = getMarketPosition(this.state.islandLevel);
    if (player.mode !== 'walking' || Math.hypot(player.x - marketPos.x, player.z - marketPos.z) > 6.0) {
      this.sendTo(uid, 'room:error', 'Avvicinati al Mini Mercato sull’isola per acquistare.');
      return;
    }

    if (player.carriedCubes.length > 0) {
      const tiers = [...player.carriedCubes];
      player.carriedCubes = [];
      this.depositCubes(uid, tiers, 'zaino');
    }

    if (this.state.bankCubes < item.cost) {
      this.sendTo(uid, 'room:error', `Servono ${item.cost} cubi nella cassa per comprare ${item.name}.`);
      return;
    }

    this.state.bankCubes -= item.cost;

    if (itemId === 'potion') {
      if (useNow && player.hp < player.maxHp) {
        player.hp = player.maxHp;
        this.emitToast({
          type: 'craft',
          message: `${prog.displayName} ha acquistato e bevuto una Pozione Vitale: Vita al massimo!`,
          color: '#f43f5e',
        });
      } else {
        prog.potions = Math.min(99, (prog.potions || 0) + 1);
        this.emitToast({
          type: 'craft',
          message: `${prog.displayName} ha comprato una Pozione Vitale (-${item.cost} ■). Premi [H] per berla!`,
          color: '#f43f5e',
        });
      }
    } else if (itemId === 'food') {
      if (useNow && player.hunger < player.maxHunger - 1) {
        player.hunger = Math.min(player.maxHunger, player.hunger + 50);
        this.hungerSaturation.set(uid, Math.min(35, (this.hungerSaturation.get(uid) ?? 0) + 25));
        this.hungerExhaustion.set(uid, 0);
        if (player.hunger > 25) this.hungerWarned.delete(uid);
        if (player.hunger > 0) this.starvationWarned.delete(uid);
        this.emitToast({
          type: 'craft',
          message: `${prog.displayName} ha comprato e mangiato Cibo dell'isola (+50 Fame)!`,
          color: '#fbbf24',
        });
      } else {
        prog.food = Math.min(99, (prog.food || 0) + 1);
        this.emitToast({
          type: 'craft',
          message: `${prog.displayName} ha comprato Cibo (-${item.cost} ■). Premi [J] per mangiare!`,
          color: '#fbbf24',
        });
      }
    }

    this.broadcast('room:sync', this.getSnapshot());
    this.broadcast('room:persist', this.getSnapshot());
  }

  public handleUsePotion(uid: string) {
    const player = this.state.players[uid];
    const prog = this.state.playerProgress[uid];
    if (!player || !prog) return;
    if ((prog.potions || 0) <= 0) {
      this.sendTo(uid, 'room:error', 'Nessuna pozione nello zaino! Comprane una al Mini Mercato.');
      return;
    }
    if (player.hp >= player.maxHp) {
      this.sendTo(uid, 'room:error', 'Hai già la Vita al massimo!');
      return;
    }
    prog.potions -= 1;
    player.hp = player.maxHp;
    this.emitToast({
      type: 'craft',
      message: `${prog.displayName} ha usato una Pozione Vitale: Vita 100/100!`,
      color: '#f43f5e',
    });
    this.broadcast('room:sync', this.getSnapshot());
    this.broadcast('room:persist', this.getSnapshot());
  }

  public handleUseFood(uid: string) {
    const player = this.state.players[uid];
    const prog = this.state.playerProgress[uid];
    if (!player || !prog) return;
    if ((prog.food || 0) <= 0) {
      this.sendTo(uid, 'room:error', 'Nessun cibo nello zaino! Comprane al Mini Mercato.');
      return;
    }
    if (player.hunger >= player.maxHunger - 0.5) {
      this.sendTo(uid, 'room:error', 'Sei già sazio!');
      return;
    }
    prog.food -= 1;
    player.hunger = Math.min(player.maxHunger, player.hunger + 50);
    this.hungerSaturation.set(uid, Math.min(35, (this.hungerSaturation.get(uid) ?? 0) + 25));
    this.hungerExhaustion.set(uid, 0);
    if (player.hunger > 25) this.hungerWarned.delete(uid);
    if (player.hunger > 0) this.starvationWarned.delete(uid);
    this.emitToast({
      type: 'craft',
      message: `${prog.displayName} ha mangiato una Razione di Cibo (+50 Fame)!`,
      color: '#fbbf24',
    });
    this.broadcast('room:sync', this.getSnapshot());
    this.broadcast('room:persist', this.getSnapshot());
  }

  private handlePlayerDeath(uid: string, cause: string) {
    const player = this.state.players[uid];
    const prog = this.state.playerProgress[uid];
    if (!player) return;

    const activeCount = Math.max(1, Object.keys(this.state.players).length);
    const lostBankCubes =
      activeCount <= 1 ? this.state.bankCubes : Math.ceil(this.state.bankCubes / activeCount);
    const lostCarried = player.carriedCubes.length;
    let lostRaftCargo = 0;

    player.carriedCubes = [];
    if (player.pilotingRaftId) {
      const raft = this.state.rafts.find((r) => r.id === player.pilotingRaftId);
      if (raft) {
        if (raft.pilotUid === uid) raft.pilotUid = null;
        lostRaftCargo += raft.cargo.length;
        raft.cargo = [];
      }
      player.pilotingRaftId = null;
    }
    if (activeCount <= 1) {
      for (const r of this.state.rafts) {
        lostRaftCargo += r.cargo.length;
        r.cargo = [];
      }
    }

    this.state.bankCubes = Math.max(0, this.state.bankCubes - lostBankCubes);
    const totalLost = lostBankCubes + lostCarried + lostRaftCargo;

    player.x = 0;
    player.z = 2.6;
    player.y =
      getWalkableSurfaceHeight(0, 2.6, this.state.islandLevel, this.state.structures) ?? 1.83;
    player.mode = 'walking';
    player.hp = player.maxHp;
    player.hunger = MAX_HUNGER;
    player.breath = player.maxBreath;

    this.hungerSaturation.set(uid, 20);
    this.hungerExhaustion.set(uid, 0);
    this.hungerWarned.delete(uid);
    this.starvationWarned.delete(uid);
    this.starvationImpactAcc.delete(uid);

    this.broadcast('room:impact', { x: player.x, z: player.z, dmg: 100 });
    this.sendTo(uid, 'room:death', { cause, lostCubes: totalLost });
    this.emitToast({
      type: 'warning',
      message: `${prog?.displayName || player.displayName} è morto per ${cause}: ha perso tutti i suoi cubi!`,
      color: '#ef4444',
    });
    this.broadcast('room:sync', this.getSnapshot());
    this.broadcast('room:persist', this.getSnapshot());
  }

  public handleRepairRaft(uid: string) {
    const prog = this.state.playerProgress[uid];
    const player = this.state.players[uid];
    if (!prog || !player || prog.repairKits <= 0) return;

    const targetRaft = player.pilotingRaftId
      ? this.state.rafts.find((r) => r.id === player.pilotingRaftId)
      : this.state.rafts.find((r) => Math.hypot(r.x - player.x, r.z - player.z) <= 8);

    if (!targetRaft || targetRaft.hp >= targetRaft.maxHp) return;
    prog.repairKits -= 1;
    targetRaft.hp = Math.min(targetRaft.maxHp, targetRaft.hp + Math.round(targetRaft.maxHp * 0.5));
    this.emitToast({
      type: 'craft',
      message: `${prog.displayName} ha riparato ${targetRaft.name}!`,
      color: '#34d399',
    });
    this.broadcast('room:sync', this.getSnapshot());
    this.broadcast('room:persist', this.getSnapshot());
  }

  public handleCraft(uid: string, recipeId: string, raftId?: string) {
    const recipe = RECIPES.find((r) => r.id === recipeId);
    const prog = this.state.playerProgress[uid];
    if (!recipe || !prog) return;

    const raftSpec = recipeId === 'raft_build_extra' ? getRaftBuildSpec(this.state.rafts.length) : null;
    const reqIsland = raftSpec ? raftSpec.requiredIslandLevel : recipe.requiredIslandLevel;
    const reqPlayer = raftSpec ? raftSpec.requiredPlayerLevel : recipe.requiredPlayerLevel;

    if (this.state.islandLevel < reqIsland) {
      this.sendTo(uid, 'room:error', `Richiede Isola Livello ${reqIsland}.`);
      return;
    }
    if (prog.level < reqPlayer) {
      this.sendTo(uid, 'room:error', `Richiede Giocatore Livello ${reqPlayer}.`);
      return;
    }

    const targetRaft =
      (raftId ? this.state.rafts.find((r) => r.id === raftId) : null) ||
      this.state.rafts.find((r) => r.pilotUid === uid) ||
      this.state.rafts[0];

    if ((recipeId === 'raft_upgrade' || recipeId === 'raft_engine') && !targetRaft) {
      this.sendTo(uid, 'room:error', 'Costruisci prima la tua prima zattera (4 cubi)!');
      return;
    }

    let currentLevel = 0;
    switch (recipeId) {
      case 'tool_magnet_net':
        currentLevel = prog.tools.magnetNetLv;
        break;
      case 'tool_harpoon':
        currentLevel = prog.tools.harpoonLv;
        break;
      case 'tool_solar_lance':
        currentLevel = prog.tools.solarLanceLv;
        break;
      case 'craft_repair_kit':
        currentLevel = 0;
        break;
      case 'raft_upgrade':
        currentLevel = targetRaft ? targetRaft.level : 1;
        break;
      case 'raft_engine':
        currentLevel = targetRaft ? targetRaft.engineLevel : 0;
        break;
      case 'raft_build_extra':
        currentLevel = this.state.rafts.length;
        break;
      case 'gear_fins':
        currentLevel = prog.gear.swimSpeedLv;
        break;
      case 'gear_backpack':
        currentLevel = prog.gear.backpackLv;
        break;
      case 'gear_storm_suit':
        currentLevel = prog.gear.stormSuitLv;
        break;
      case 'struct_dock':
        currentLevel = this.state.structures.dockLevel;
        break;
      case 'struct_refinery':
        currentLevel = this.state.structures.refineryLevel;
        break;
      case 'struct_platform':
        currentLevel = this.state.structures.platformLevel;
        break;
      case 'struct_autocollector':
        currentLevel = this.state.structures.autoCollectorLevel;
        break;
      case 'struct_lighthouse':
        currentLevel = this.state.structures.lighthouseLevel;
        break;
      case 'struct_bay_shield':
        currentLevel = this.state.structures.bayShieldLevel;
        break;
      case 'island_upgrade':
        currentLevel = this.state.islandLevel;
        break;
      default:
        return;
    }

    if (!recipe.consumable && currentLevel >= recipe.maxLevel) {
      this.sendTo(uid, 'room:error', 'Potenziamento già al livello massimo.');
      return;
    }

    const cost = raftSpec ? raftSpec.cost : computeRecipeCost(recipe, currentLevel);
    if (this.state.bankCubes < cost) {
      this.sendTo(uid, 'room:error', `Servono ${cost} cubi nella cassa dell'isola.`);
      return;
    }

    this.state.bankCubes -= cost;

    switch (recipeId) {
      case 'tool_magnet_net':
        prog.tools.magnetNetLv += 1;
        prog.activeTool = 'magnet_net';
        if (this.state.players[uid]) this.state.players[uid].activeTool = 'magnet_net';
        break;
      case 'tool_harpoon':
        prog.tools.harpoonLv += 1;
        prog.activeTool = 'harpoon';
        if (this.state.players[uid]) this.state.players[uid].activeTool = 'harpoon';
        break;
      case 'tool_solar_lance':
        prog.tools.solarLanceLv += 1;
        prog.activeTool = 'solar_lance';
        if (this.state.players[uid]) this.state.players[uid].activeTool = 'solar_lance';
        break;
      case 'craft_repair_kit':
        prog.repairKits += 1;
        break;
      case 'raft_upgrade':
        if (targetRaft) {
          targetRaft.level += 1;
          targetRaft.capacity = getRaftCapacity(targetRaft.level);
          targetRaft.hullLevel = targetRaft.level;
          targetRaft.maxHp = 100 + (targetRaft.level - 1) * 45;
          targetRaft.hp = targetRaft.maxHp;
        }
        break;
      case 'raft_engine':
        if (targetRaft) {
          targetRaft.engineLevel += 1;
        }
        break;
      case 'raft_build_extra': {
        const idx = this.state.rafts.length;
        const newRaft = createInitialRaft(idx);
        const r = getIslandRadius(this.state.islandLevel) + 4.5;
        const a = idx * 1.65;
        newRaft.x = Math.cos(a) * r;
        newRaft.z = Math.sin(a) * r;
        this.state.rafts.push(newRaft);
        break;
      }
      case 'gear_fins':
        prog.gear.swimSpeedLv += 1;
        break;
      case 'gear_backpack':
        prog.gear.backpackLv += 1;
        break;
      case 'gear_storm_suit':
        prog.gear.stormSuitLv += 1;
        break;
      case 'struct_dock':
        this.state.structures.dockLevel += 1;
        break;
      case 'struct_refinery':
        this.state.structures.refineryLevel += 1;
        break;
      case 'struct_platform':
        this.state.structures.platformLevel += 1;
        break;
      case 'struct_autocollector':
        this.state.structures.autoCollectorLevel += 1;
        break;
      case 'struct_lighthouse':
        this.state.structures.lighthouseLevel += 1;
        break;
      case 'struct_bay_shield':
        this.state.structures.bayShieldLevel += 1;
        break;
      case 'island_upgrade':
        this.state.islandLevel += 1;
        break;
    }

    this.awardXp(uid, recipe.xpReward);
    this.emitToast({
      type: 'craft',
      message: `${prog.displayName} ha fabbricato: ${recipe.name}!`,
      color: '#f59e0b',
    });

    this.broadcast('room:sync', this.getSnapshot());
    this.broadcast('room:persist', this.getSnapshot());
  }

  public tick(dt: number) {
    const now = Date.now();
    this.state.serverTime = now;
    const tSec = now * 0.001;
    const waveTime = getSyncedWaveTime(now);
    const islandR = getIslandRadius(this.state.islandLevel);
    const platformReach = islandR + this.state.structures.platformLevel * 3.2;
    const dockReach = islandR + 10 + this.state.structures.dockLevel * 3.5;

    // 0. Dynamic Weather Cycle (sunny -> light_rain -> heavy_storm)
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      const order: WeatherPhase[] = ['sunny', 'light_rain', 'heavy_storm'];
      const nextIdx = (order.indexOf(this.state.weather.phase) + 1) % order.length;
      const nextPhase = order[nextIdx];
      this.state.weather.phase = nextPhase;
      this.weatherTimer = nextPhase === 'sunny' ? 45 : nextPhase === 'light_rain' ? 30 : 26;
      const msg =
        nextPhase === 'sunny'
          ? 'Il cielo si apre: torna il sole sull’oceano!'
          : nextPhase === 'light_rain'
            ? 'Inizia una pioggia leggera al largo.'
            : 'Attenzione: Tempesta Intensa in mare aperto! Onde alte e visibilità ridotta.';
      this.emitToast({
        type: nextPhase === 'heavy_storm' ? 'warning' : 'pickup',
        message: msg,
        color: nextPhase === 'heavy_storm' ? '#f59e0b' : '#38bdf8',
      });
    }
    const targetIntensity =
      this.state.weather.phase === 'sunny'
        ? 0
        : this.state.weather.phase === 'light_rain'
          ? 0.45
          : 1.0;
    this.state.weather.intensity +=
      (targetIntensity - this.state.weather.intensity) * Math.min(1, dt * 0.65);
    this.state.weather.nextChangeInSec = Math.max(0, Math.ceil(this.weatherTimer));

    // 0b. Day/Night Cycle, Night Surge Regeneration & Daily Cube Reset
    this.state.dayState.timeOfDay += dt / this.state.dayState.cycleDurationSec;
    if (this.state.dayState.timeOfDay >= 1.0) {
      this.state.dayState.timeOfDay -= 1.0;
      this.state.dayState.day += 1;
      this.wasNightPhase = false;
      this.nightCubeSurgeAcc = 0;
      this.regenerateDailyCubes();
    }
    const nightFactor = this.getNightFactor();
    if (nightFactor >= 0.55 && !this.wasNightPhase) {
      this.wasNightPhase = true;
      this.refillCubes();
      this.emitToast({
        type: 'warning',
        message: 'Cala la notte: affiorano più cubi rari, ma gli squali e le tempeste al largo sono più aggressivi!',
        color: '#818cf8',
      });
    } else if (nightFactor < 0.2) {
      this.wasNightPhase = false;
    }
    if (nightFactor > 0.45) {
      this.nightCubeSurgeAcc += dt;
      if (this.nightCubeSurgeAcc >= 7) {
        this.nightCubeSurgeAcc = 0;
        this.refillCubes();
      }
    }

    // 1. Move storms slowly in outer waters (faster & stronger at night)
    const stormOrbitSpeed = 0.045 * (1 + nightFactor * 0.52);
    for (let i = 0; i < this.state.storms.length; i++) {
      const s = this.state.storms[i];
      const orbitAngle = Math.atan2(s.z, s.x) + dt * stormOrbitSpeed * (i % 2 === 0 ? 1 : -1);
      const orbitR = Math.hypot(s.x, s.z);
      s.x = Math.cos(orbitAngle) * orbitR;
      s.z = Math.sin(orbitAngle) * orbitR;
    }

    // 2. Update players & piloted rafts (including weather impact in open sea)
    const globalWeather = this.state.weather.intensity;
    for (const [uid, player] of Object.entries(this.state.players)) {
      player.toolCooldown = Math.max(0, player.toolCooldown - dt);
      const prog = this.state.playerProgress[uid];
      const client = this.clients.get(uid);
      const input = client?.input || { moveX: 0, moveZ: 0, sprint: false };
      const len = Math.hypot(input.moveX, input.moveZ);
      const nx = len > 0.01 ? input.moveX / Math.max(1, len) : 0;
      const nz = len > 0.01 ? input.moveZ / Math.max(1, len) : 0;

      if (player.mode === 'piloting' && player.pilotingRaftId) {
        const raft = this.state.rafts.find((r) => r.id === player.pilotingRaftId);
        if (raft) {
          const dCenterPre = Math.hypot(raft.x, raft.z);
          const openSeaFactor = Math.min(1, Math.max(0, (dCenterPre - (islandR + 12)) / 65));
          const localWeatherHit = Math.max(
            this.getStormIntensityAt(raft.x, raft.z),
            globalWeather * openSeaFactor
          );
          const speed = (10.5 + raft.level * 1.4 + raft.engineLevel * 3.2) * (input.sprint ? 1.25 : 1);
          const waveDrag = 1 - localWeatherHit * Math.max(0.08, 0.36 - raft.engineLevel * 0.07);
          const windDriftX = Math.sin(tSec * 0.35) * localWeatherHit * 2.2 * Math.max(0.25, 1 - raft.engineLevel * 0.2);
          const windDriftZ = Math.cos(tSec * 0.28) * localWeatherHit * 2.2 * Math.max(0.25, 1 - raft.engineLevel * 0.2);

          const targetVx = nx * speed * waveDrag + windDriftX;
          const targetVz = nz * speed * waveDrag + windDriftZ;
          raft.vx += (targetVx - raft.vx) * Math.min(1, dt * 6);
          raft.vz += (targetVz - raft.vz) * Math.min(1, dt * 6);
          raft.x += raft.vx * dt;
          raft.z += raft.vz * dt;

          // Keep outside island core, allow docking close
          const dCenter = Math.hypot(raft.x, raft.z);
          const minRaftDist = islandR + 1.8;
          if (dCenter < minRaftDist && dCenter > 0.01) {
            raft.x = (raft.x / dCenter) * minRaftDist;
            raft.z = (raft.z / dCenter) * minRaftDist;
          }
          // World boundary clamp (245m)
          if (dCenter > 245) {
            raft.x = (raft.x / dCenter) * 245;
            raft.z = (raft.z / dCenter) * 245;
          }

          if (Math.hypot(raft.vx, raft.vz) > 0.5) {
            raft.angle = Math.atan2(raft.vx, raft.vz);
          }

          player.x = raft.x;
          player.z = raft.z;
          player.y = getWaveHeight(raft.x, raft.z, waveTime, localWeatherHit, islandR) + 0.55;
          player.angle = raft.angle;
          player.breath = Math.min(player.maxBreath, player.breath + dt * 4.5);

          // Auto-offload if Dock Lv >= 1 and raft enters dock reach
          if (this.state.structures.dockLevel >= 1 && dCenter <= dockReach && raft.cargo.length > 0) {
            const tiers = [...raft.cargo];
            raft.cargo = [];
            this.depositCubes(uid, tiers, `${raft.name} (Molo Auto)`);
            this.broadcast('room:sync', this.getSnapshot());
          }

          // Storm chip damage
          if (localWeatherHit > 0.52) {
            const suitMitigation = 1 - (prog?.gear.stormSuitLv || 0) * 0.25;
            const lhMitigation = 1 - this.state.structures.lighthouseLevel * 0.14;
            const dmg = dt * 2.4 * localWeatherHit * Math.max(0.2, suitMitigation) * Math.max(0.4, lhMitigation);
            raft.hp = Math.max(1, raft.hp - dmg);
          }
        }
      } else {
        const finsMult = 1 + ((prog?.gear.swimSpeedLv || 1) - 1) * 0.22;
        const distFromCenter = Math.hypot(player.x, player.z);
        const curSurface = getWalkableSurfaceHeight(
          player.x,
          player.z,
          this.state.islandLevel,
          this.state.structures
        );
        const onIsland = curSurface !== null;
        const openSeaSwimmer = onIsland ? 0 : Math.min(1, Math.max(0, (distFromCenter - (islandR + 10)) / 50));
        const swimmerWeather = Math.max(this.getStormIntensityAt(player.x, player.z), globalWeather * openSeaSwimmer);
        const suitBonus = (prog?.gear.stormSuitLv || 0) * 0.08;
        const weatherSlow = onIsland ? 1 : 1 - swimmerWeather * Math.max(0.05, 0.28 - suitBonus);

        const baseSpeed = onIsland ? 9.5 : 6.6;
        const speed = baseSpeed * finsMult * weatherSlow * (input.sprint ? 1.25 : 1);

        player.x += nx * speed * dt;
        player.z += nz * speed * dt;
        const nextDist = Math.hypot(player.x, player.z);
        if (nextDist > 240) {
          player.x = (player.x / nextDist) * 240;
          player.z = (player.z / nextDist) * 240;
        }
        if (len > 0.05) {
          player.angle = Math.atan2(nx, nz);
        }

        const nextSurface = getWalkableSurfaceHeight(
          player.x,
          player.z,
          this.state.islandLevel,
          this.state.structures
        );
        if (nextSurface !== null) {
          player.mode = 'walking';
          player.y = nextSurface;
          player.breath = Math.min(player.maxBreath, player.breath + dt * 4.5);
          if (player.carriedCubes.length > 0 && nextDist <= islandR * 0.85) {
            const tiers = [...player.carriedCubes];
            player.carriedCubes = [];
            this.depositCubes(uid, tiers, 'riva');
            this.broadcast('room:sync', this.getSnapshot());
          }
        } else {
          player.mode = 'swimming';
          // Submerge player torso/legs below waterline so character swims instead of walking on water
          player.y = getWaveHeight(player.x, player.z, waveTime, swimmerWeather, islandR) - 1.15;
          player.breath = Math.max(0, player.breath - dt);

          if (player.breath <= 0) {
            // Out of 10s oxygen -> inflict HP damage, drop half carried cubes, and force teleport back to island (or die if HP hits 0)
            player.hp = Math.max(0, Math.round(player.hp - 35));
            if (player.hp <= 0) {
              this.handlePlayerDeath(uid, 'mancanza di ossigeno');
              continue;
            }
            const dropped = Math.ceil(player.carriedCubes.length / 2);
            player.carriedCubes = player.carriedCubes.slice(0, player.carriedCubes.length - dropped);
            const shoreAngle = Math.atan2(player.z, player.x);
            player.x = Math.cos(shoreAngle) * (islandR * 0.58);
            player.z = Math.sin(shoreAngle) * (islandR * 0.58);
            player.mode = 'walking';
            player.breath = player.maxBreath;
            player.y =
              getWalkableSurfaceHeight(
                player.x,
                player.z,
                this.state.islandLevel,
                this.state.structures
              ) ?? 1.55;
            this.broadcast('room:impact', { x: player.x, z: player.z, dmg: 35 });
            this.emitToast({
              type: 'warning',
              message: `${player.displayName} ha esaurito l'Ossigeno (10s): -35 Vita e ritorno forzato all'isola${dropped > 0 ? ` (-${dropped} cubi)` : ''}!`,
              color: '#f43f5e',
            });
            this.broadcast('room:sync', this.getSnapshot());
          }
        }
      }

      // Minecraft-style hunger depletion: exhaustion builds only on exertion, drains saturation first, then drops hunger in 5-pt steps
      let exertionRate = 0;
      if (player.mode === 'swimming') {
        exertionRate = len > 0.05 ? (input.sprint ? 1.25 : 0.75) : 0.25;
      } else if (player.mode === 'walking' && len > 0.05) {
        exertionRate = input.sprint ? 0.95 : 0.08;
      }

      if (exertionRate > 0) {
        let exhaustion = (this.hungerExhaustion.get(uid) ?? 0) + dt * exertionRate;
        let saturation = this.hungerSaturation.get(uid) ?? 0;
        const EXHAUSTION_STEP = 4.0;
        while (exhaustion >= EXHAUSTION_STEP) {
          exhaustion -= EXHAUSTION_STEP;
          if (saturation > 0) {
            saturation = Math.max(0, saturation - 5);
          } else {
            player.hunger = Math.max(0, player.hunger - 5);
          }
        }
        this.hungerExhaustion.set(uid, exhaustion);
        this.hungerSaturation.set(uid, saturation);
      }

      if (player.hunger <= 25 && player.hunger > 0 && !this.hungerWarned.has(uid)) {
        this.hungerWarned.add(uid);
        this.sendTo(uid, 'room:toast', {
          id: `${Date.now()}-hunger-${uid}`,
          type: 'warning',
          message: 'Hai fame! Vai al Mini Mercato sull’isola per comprare del cibo.',
          color: '#fbbf24',
        });
      }

      if (player.hunger <= 0) {
        if (!this.starvationWarned.has(uid)) {
          this.starvationWarned.add(uid);
          this.sendTo(uid, 'room:toast', {
            id: `${Date.now()}-starve-${uid}`,
            type: 'warning',
            message: 'Fame a 0! Stai perdendo Vita: mangia subito o muori perdendo tutti i cubi!',
            color: '#ef4444',
          });
        }
        player.hp = Math.max(0, player.hp - dt * 4.5);
        const acc = (this.starvationImpactAcc.get(uid) || 0) + dt;
        if (acc >= 3.5) {
          this.starvationImpactAcc.set(uid, 0);
          this.sendTo(uid, 'room:impact', { x: player.x, z: player.z, dmg: 15 });
        } else {
          this.starvationImpactAcc.set(uid, acc);
        }
      }

      if (player.hp <= 0) {
        this.handlePlayerDeath(uid, 'fame');
      }
    }

    // 3. Damp unpiloted rafts gently
    for (const raft of this.state.rafts) {
      if (!raft.pilotUid) {
        raft.vx *= Math.pow(0.08, dt);
        raft.vz *= Math.pow(0.08, dt);
        raft.x += raft.vx * dt;
        raft.z += raft.vz * dt;
      }
    }

    // 4. Cube pickup collision
    const remainingCubes: WorldCube[] = [];
    let pickedAny = false;
    for (const cube of this.state.worldCubes) {
      let claimed = false;
      for (const [uid, player] of Object.entries(this.state.players)) {
        const prog = this.state.playerProgress[uid];
        const magnetBonus = prog?.tools.magnetNetLv ? prog.tools.magnetNetLv * 1.2 : 0;
        const solarBonus = prog?.tools.solarLanceLv ? 2.5 : 0;
        const pickupRadius = (player.mode === 'piloting' ? 3.8 : 2.6) + magnetBonus + solarBonus;
        const d = Math.hypot(cube.x - player.x, cube.z - player.z);
        if (d <= pickupRadius) {
          if (player.mode === 'piloting' && player.pilotingRaftId) {
            const raft = this.state.rafts.find((r) => r.id === player.pilotingRaftId);
            if (raft && raft.cargo.length < raft.capacity) {
              raft.cargo.push(cube.tier);
              this.awardXp(uid, cube.xp);
              this.sendTo(uid, 'room:pickup', { tier: cube.tier, x: cube.x, z: cube.z });
              claimed = true;
              pickedAny = true;
              break;
            }
          } else {
            const backpackCap = getBackpackCapacity(prog?.gear.backpackLv || 1);
            if (player.carriedCubes.length < backpackCap) {
              player.carriedCubes.push(cube.tier);
              this.awardXp(uid, cube.xp);
              this.sendTo(uid, 'room:pickup', { tier: cube.tier, x: cube.x, z: cube.z });
              claimed = true;
              pickedAny = true;
              break;
            }
          }
        }
      }
      if (!claimed) {
        remainingCubes.push(cube);
      }
    }
    if (pickedAny) {
      this.state.worldCubes = remainingCubes;
      this.cubesDirty = true;
      this.refillCubes();
      this.broadcast('room:sync', this.getSnapshot());
    }

    // 5. Auto-collector buoys & drones
    if (this.state.structures.autoCollectorLevel > 0) {
      this.harvesterAcc += dt;
      const interval = Math.max(1.4, 3.6 - this.state.structures.autoCollectorLevel * 0.42);
      if (this.harvesterAcc >= interval) {
        this.harvesterAcc = 0;
        const harvestRadius = islandR + 28 + this.state.structures.autoCollectorLevel * 14;
        const maxPick = this.state.structures.autoCollectorLevel;
        const mult = getRefineryMultiplier(this.state.structures.refineryLevel);

        let harvested = 0;
        let gainedCubes = 0;
        const nextCubes: WorldCube[] = [];
        for (const cube of this.state.worldCubes) {
          if (harvested < maxPick && Math.hypot(cube.x, cube.z) <= harvestRadius) {
            harvested++;
            gainedCubes += Math.max(1, Math.round(cube.value * mult));
            this.broadcast('room:harvester_beam', { x: cube.x, z: cube.z, tier: cube.tier });
          } else {
            nextCubes.push(cube);
          }
        }
        if (harvested > 0) {
          this.state.worldCubes = nextCubes;
          this.state.bankCubes += gainedCubes;
          this.cubesDirty = true;
          this.refillCubes();
          this.broadcast('room:sync', this.getSnapshot());
        }
      }
    }

    // 6. Sharks AI & hazards
    const bayShieldR =
      this.state.structures.bayShieldLevel > 0
        ? islandR + 30 + this.state.structures.bayShieldLevel * 11
        : islandR + 18;

    for (let i = 0; i < this.state.sharks.length; i++) {
      const shark = this.state.sharks[i];
      if (shark.stunTimer > 0) {
        shark.stunTimer = Math.max(0, shark.stunTimer - dt);
        if (shark.stunTimer === 0) shark.state = 'patrol';
        continue;
      }

      // Find nearest vulnerable raft or swimmer outside safe bay (wider detection at night)
      let targetX = 0;
      let targetZ = 0;
      let targetDist = 48 + nightFactor * 20;
      let targetKind: 'raft' | 'swimmer' | null = null;
      let targetId = '';

      for (const raft of this.state.rafts) {
        if (!raft.pilotUid) continue;
        const distFromIsland = Math.hypot(raft.x, raft.z);
        if (distFromIsland <= bayShieldR) continue;
        const d = Math.hypot(raft.x - shark.x, raft.z - shark.z);
        if (d < targetDist) {
          targetDist = d;
          targetX = raft.x;
          targetZ = raft.z;
          targetKind = 'raft';
          targetId = raft.id;
        }
      }

      if (!targetKind) {
        for (const player of Object.values(this.state.players)) {
          if (player.mode !== 'swimming') continue;
          const distFromIsland = Math.hypot(player.x, player.z);
          if (distFromIsland <= bayShieldR) continue;
          const d = Math.hypot(player.x - shark.x, player.z - shark.z);
          if (d < targetDist) {
            targetDist = d;
            targetX = player.x;
            targetZ = player.z;
            targetKind = 'swimmer';
            targetId = player.uid;
          }
        }
      }

      if (targetKind) {
        shark.state = 'chase';
        shark.targetRaftId = targetKind === 'raft' ? targetId : null;
        const desiredAngle = Math.atan2(targetX - shark.x, targetZ - shark.z);
        shark.angle = desiredAngle;
        const chaseSpeed = 10.2 + nightFactor * 2.4 + Math.min(4, Math.hypot(shark.x, shark.z) * 0.02);
        shark.x += Math.sin(shark.angle) * chaseSpeed * dt;
        shark.z += Math.cos(shark.angle) * chaseSpeed * dt;

        // Attack on contact
        if (targetDist < 3.6) {
          shark.stunTimer = Math.max(1.75, 2.6 - nightFactor * 0.8);
          shark.state = 'patrol';
          const pushAngle = shark.angle + Math.PI;
          shark.x += Math.sin(pushAngle) * 10;
          shark.z += Math.cos(pushAngle) * 10;

          if (targetKind === 'raft') {
            const raft = this.state.rafts.find((r) => r.id === targetId);
            if (raft) {
              const pilotProg = raft.pilotUid ? this.state.playerProgress[raft.pilotUid] : null;
              const suitRed = 1 - (pilotProg?.gear.stormSuitLv || 0) * 0.2;
              const dmg = Math.round((24 + nightFactor * 9) * suitRed);
              raft.hp = Math.max(0, raft.hp - dmg);
              this.broadcast('room:impact', { x: raft.x, z: raft.z, dmg });

              if (raft.hp <= 0) {
                // Raft wrecked -> lose half cargo and tow back to island
                const lostCount = Math.ceil(raft.cargo.length / 2);
                raft.cargo.splice(0, lostCount);
                raft.hp = Math.round(raft.maxHp * 0.65);
                const towAngle = Math.atan2(raft.z, raft.x);
                raft.x = Math.cos(towAngle) * (islandR + 5);
                raft.z = Math.sin(towAngle) * (islandR + 5);
                if (raft.pilotUid && this.state.players[raft.pilotUid]) {
                  this.state.players[raft.pilotUid].x = raft.x;
                  this.state.players[raft.pilotUid].z = raft.z;
                }
                this.emitToast({
                  type: 'warning',
                  message: `Uno squalo ha danneggiato ${raft.name}! Riportata a riva (-${lostCount} cubi).`,
                  color: '#ef4444',
                });
              } else {
                this.emitToast({
                  type: 'warning',
                  message: `Attacco squalo su ${raft.name}! Scafo: ${Math.round(raft.hp)}/${raft.maxHp}`,
                  color: '#f97316',
                });
              }
              this.broadcast('room:sync', this.getSnapshot());
            }
          } else {
            const swimmer = this.state.players[targetId];
            if (swimmer) {
              const swimmerDmg = 20;
              swimmer.hp = Math.max(0, swimmer.hp - swimmerDmg);
              if (swimmer.hp <= 0) {
                this.handlePlayerDeath(targetId, 'attacco di squalo');
              } else {
                swimmer.carriedCubes = swimmer.carriedCubes.slice(0, Math.floor(swimmer.carriedCubes.length / 2));
                const towAngle = Math.atan2(swimmer.z, swimmer.x);
                swimmer.x = Math.cos(towAngle) * (islandR * 0.6);
                swimmer.z = Math.sin(towAngle) * (islandR * 0.6);
                swimmer.mode = 'walking';
                this.broadcast('room:impact', { x: swimmer.x, z: swimmer.z, dmg: swimmerDmg });
                this.emitToast({
                  type: 'warning',
                  message: `Uno squalo ha attaccato ${swimmer.displayName} (-${swimmerDmg} Vita) riportandolo a riva!`,
                  color: '#ef4444',
                });
              }
            }
          }
        }
      } else {
        shark.state = 'patrol';
        shark.targetRaftId = null;
        const curDist = Math.hypot(shark.x, shark.z);
        const orbitDir = i % 2 === 0 ? 1 : -1;
        const targetOrbit = Math.max(bayShieldR + 12, 62 + (i % 3) * 42);
        const radialAdjust = (targetOrbit - curDist) * 0.4;
        const radialAngle = Math.atan2(shark.z, shark.x);
        const tangentAngle = radialAngle + (Math.PI / 2) * orbitDir;
        const speed = 6.2 + nightFactor * 1.4;
        shark.x += (Math.cos(tangentAngle) * speed + Math.cos(radialAngle) * radialAdjust) * dt;
        shark.z += (Math.sin(tangentAngle) * speed + Math.sin(radialAngle) * radialAdjust) * dt;
        shark.angle = Math.atan2(Math.cos(tangentAngle), Math.sin(tangentAngle));
      }
    }

    // 7. Broadcast 20 Hz world tick
    this.broadcast('room:tick', {
      players: this.state.players,
      rafts: this.state.rafts.map((r) => ({
        id: r.id,
        x: Number(r.x.toFixed(2)),
        z: Number(r.z.toFixed(2)),
        angle: Number(r.angle.toFixed(3)),
        hp: Math.round(r.hp),
        maxHp: r.maxHp,
        cargo: r.cargo,
        pilotUid: r.pilotUid,
      })),
      sharks: this.state.sharks.map((s) => ({
        id: s.id,
        x: Number(s.x.toFixed(2)),
        z: Number(s.z.toFixed(2)),
        angle: Number(s.angle.toFixed(3)),
        state: s.state,
      })),
      storms: this.state.storms.map((st) => ({
        id: st.id,
        x: Number(st.x.toFixed(2)),
        z: Number(st.z.toFixed(2)),
        radius: st.radius,
        intensity: st.intensity,
      })),
      weather: { ...this.state.weather },
      dayState: { ...this.state.dayState },
      worldCubes: this.cubesDirty ? this.state.worldCubes : undefined,
      serverTime: now,
    });
    this.cubesDirty = false;
  }

  private getStormIntensityAt(x: number, z: number): number {
    let maxInt = 0;
    const nightBoost = 1 + this.getNightFactor() * 0.16;
    for (const s of this.state.storms) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.radius) {
        const falloff = 1 - d / s.radius;
        maxInt = Math.max(maxInt, Math.min(1.15, s.intensity * nightBoost * falloff));
      }
    }
    return maxInt;
  }
}

const rooms = new Map<string, RoomSimulation>();

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  app.get('/api/logo/download', (_req, res) => {
    const candidates = [
      path.resolve(__dirname, 'public', 'cubi-alla-deriva-logo.jpg'),
      path.resolve(__dirname, 'dist', 'cubi-alla-deriva-logo.jpg'),
      path.resolve(__dirname, 'src', 'assets', 'images', 'cubi_deriva_logo_1795286876893.jpg'),
    ];
    const logoPath = candidates.find((p) => fs.existsSync(p));
    if (!logoPath) {
      res.status(404).json({ error: 'Logo non trovato.' });
      return;
    }
    res.download(logoPath, 'cubi-alla-deriva-logo.jpg');
  });

  const almanacCache = new Map<
    string,
    { answer: string; sources: Array<{ title: string; uri: string }> }
  >();

  app.post('/api/almanac', async (req, res) => {
    const queryText = String(req.body?.query || '').trim();
    if (!queryText) {
      res.status(400).json({ error: 'Inserisci una domanda per l’Atlante Oceanico.' });
      return;
    }
    if (!ai) {
      res.status(503).json({
        error: 'Chiave GEMINI_API_KEY non configurata nel pannello Settings > Secrets.',
      });
      return;
    }

    const cacheKey = queryText.toLowerCase();
    const cached = almanacCache.get(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const modelsToTry = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
    let lastErr: any = null;

    for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
      const model = modelsToTry[attempt];
      try {
        const response = await ai.models.generateContent({
          model,
          contents: queryText,
          config: {
            systemInstruction:
              'Sei l’Atlante Oceanico di un gioco d’avventura marina. Rispondi in italiano chiaro, conciso (max 140 parole) e accurato basandoti su dati reali dal web riguardo mari, correnti, tempeste, fari, zattere o squali.',
            tools: [{ googleSearch: {} }],
          },
        });

        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const sources = chunks
          .map((c: any) =>
            c?.web?.uri ? { title: c.web.title || c.web.uri, uri: c.web.uri } : null
          )
          .filter((s: any): s is { title: string; uri: string } => Boolean(s))
          .slice(0, 5);

        const payload = {
          answer: response.text || 'Nessuna informazione trovata al momento.',
          sources,
        };
        almanacCache.set(cacheKey, payload);
        res.json(payload);
        return;
      } catch (err: any) {
        lastErr = err;
        const raw = String(err?.message || '');
        const status = err?.status || (raw.includes('429') ? 429 : 500);
        if (attempt < modelsToTry.length - 1 && (status === 429 || status === 503)) {
          await new Promise((r) => setTimeout(r, 650 * (attempt + 1)));
          continue;
        }
        break;
      }
    }

    console.error('Almanac API error:', lastErr);
    const rawMsg = String(lastErr?.message || '');
    const isQuota =
      lastErr?.status === 429 ||
      rawMsg.includes('RESOURCE_EXHAUSTED') ||
      rawMsg.includes('"code":429');
    const isAuth =
      lastErr?.status === 403 ||
      rawMsg.includes('PERMISSION_DENIED') ||
      rawMsg.includes('API_KEY_INVALID');

    if (isQuota) {
      res.status(429).json({
        error:
          'Quota API Gemini temporaneamente esaurita (429). Riprova tra qualche secondo oppure seleziona una chiave API con piano a pagamento in Settings > Secrets.',
      });
      return;
    }
    if (isAuth) {
      res.status(403).json({
        error:
          'Chiave API Gemini non valida o non autorizzata. Verifica GEMINI_API_KEY in Settings > Secrets.',
      });
      return;
    }
    res.status(500).json({
      error: 'Errore temporaneo nella ricerca sull’Atlante Oceanico. Riprova tra poco.',
    });
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let joinedRoom: RoomSimulation | null = null;
    let joinedUid = '';

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'room:join') {
          const roomCode = String(msg.payload?.roomCode || 'SOLO-0001').toUpperCase();
          const uid = String(msg.payload?.uid || `guest-${Math.random().toString(36).slice(2, 8)}`);
          const displayName = String(msg.payload?.displayName || 'Esploratore').slice(0, 32);
          const initialSnapshot: RoomSnapshot | undefined = msg.payload?.initialSnapshot;

          let sim = rooms.get(roomCode);
          if (!sim) {
            const snap =
              initialSnapshot || createDefaultRoomSnapshot(roomCode, 'Isola del Sole', uid, displayName);
            sim = new RoomSimulation(snap);
            rooms.set(roomCode, sim);
          }

          joinedRoom = sim;
          joinedUid = uid;
          sim.addOrUpdatePlayer(uid, displayName, ws);

          ws.send(JSON.stringify({ type: 'room:init', payload: sim.state }));
          sim.broadcast('room:sync', sim.getSnapshot());
          return;
        }

        if (!joinedRoom || !joinedUid) return;

        if (msg.type === 'player:input') {
          const client = joinedRoom.clients.get(joinedUid);
          if (client) {
            client.input = {
              moveX: Number(msg.payload?.moveX || 0),
              moveZ: Number(msg.payload?.moveZ || 0),
              sprint: Boolean(msg.payload?.sprint),
            };
          }
        } else if (msg.type === 'player:action') {
          const action = msg.payload?.action;
          if (action === 'interact') joinedRoom.handleInteract(joinedUid);
          else if (action === 'deposit') joinedRoom.handleDepositAction(joinedUid);
          else if (action === 'sleep') joinedRoom.handleSleep(joinedUid);
          else if (action === 'use_potion') joinedRoom.handleUsePotion(joinedUid);
          else if (action === 'use_food') joinedRoom.handleUseFood(joinedUid);
          else if (action === 'use_tool') {
            joinedRoom.handleUseTool(
              joinedUid,
              typeof msg.payload?.targetX === 'number' ? msg.payload.targetX : undefined,
              typeof msg.payload?.targetZ === 'number' ? msg.payload.targetZ : undefined
            );
          } else if (action === 'repair_raft') joinedRoom.handleRepairRaft(joinedUid);
        } else if (msg.type === 'market:buy') {
          const itemId = msg.payload?.itemId;
          if (itemId === 'potion' || itemId === 'food') {
            joinedRoom.handleMarketBuy(joinedUid, itemId, Boolean(msg.payload?.useNow));
          }
        } else if (msg.type === 'player:select_tool') {
          joinedRoom.handleSelectTool(joinedUid, msg.payload?.tool as ToolId);
        } else if (msg.type === 'craft:execute') {
          joinedRoom.handleCraft(joinedUid, String(msg.payload?.recipeId || ''), msg.payload?.raftId);
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      if (joinedRoom && joinedUid) {
        joinedRoom.removeClient(joinedUid);
        if (joinedRoom.clients.size === 0) {
          rooms.delete(joinedRoom.state.roomCode);
        } else {
          joinedRoom.broadcast('room:sync', joinedRoom.getSnapshot());
        }
      }
    });
  });

  // Authoritative 20 Hz simulation loop
  const TICK_MS = 50;
  setInterval(() => {
    for (const sim of rooms.values()) {
      if (sim.clients.size > 0) {
        sim.tick(TICK_MS / 1000);
      }
    }
  }, TICK_MS);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Cubi alla Deriva server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
