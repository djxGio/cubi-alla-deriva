export type CubeTier = 'base' | 'rare' | 'epic' | 'solar';

export type ToolId = 'net' | 'magnet_net' | 'harpoon' | 'solar_lance';

export type RecipeCategory = 'tools' | 'rafts_gear' | 'structures' | 'island';

export type WeatherPhase = 'sunny' | 'light_rain' | 'heavy_storm';

export interface WeatherState {
  phase: WeatherPhase;
  intensity: number;
  nextChangeInSec: number;
}

export interface DayState {
  day: number;
  timeOfDay: number; // 0..1 (0.05 dawn, 0.35 noon, 0.7 sunset, 0.85 night)
  cycleDurationSec: number;
}

export function isNightTime(timeOfDay: number): boolean {
  return timeOfDay >= 0.78 || timeOfDay < 0.05;
}

export interface StructuresState {
  refineryLevel: number;
  dockLevel: number;
  lighthouseLevel: number;
  autoCollectorLevel: number;
  platformLevel: number;
  bayShieldLevel: number;
}

export interface RaftState {
  id: string;
  name: string;
  level: number;
  capacity: number;
  engineLevel: number;
  hullLevel: number;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  angle: number;
  vx: number;
  vz: number;
  cargo: CubeTier[];
  pilotUid: string | null;
}

export interface PlayerToolsState {
  netLv: number;
  magnetNetLv: number;
  harpoonLv: number;
  solarLanceLv: number;
}

export interface PlayerGearState {
  swimSpeedLv: number;
  backpackLv: number;
  stormSuitLv: number;
}

export interface PlayerProgress {
  uid: string;
  displayName: string;
  color: string;
  xp: number;
  level: number;
  activeTool: ToolId;
  tools: PlayerToolsState;
  gear: PlayerGearState;
  repairKits: number;
  potions: number;
  food: number;
}

export interface LivePlayerState {
  uid: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
  z: number;
  angle: number;
  mode: 'walking' | 'swimming' | 'piloting';
  pilotingRaftId: string | null;
  carriedCubes: CubeTier[];
  hp: number;
  maxHp: number;
  hunger: number;
  maxHunger: number;
  activeTool: ToolId;
  toolCooldown: number;
  lastToolPulseAt: number;
  breath: number;
  maxBreath: number;
}

export interface WorldCube {
  id: string;
  x: number;
  z: number;
  tier: CubeTier;
  value: number;
  xp: number;
}

export interface SharkEntity {
  id: string;
  x: number;
  z: number;
  angle: number;
  state: 'patrol' | 'chase' | 'stunned';
  stunTimer: number;
  targetRaftId: string | null;
}

export interface StormCell {
  id: string;
  x: number;
  z: number;
  radius: number;
  intensity: number;
}

export interface GameEventToast {
  id: string;
  type: 'pickup' | 'deposit' | 'craft' | 'warning' | 'harvester' | 'levelup';
  message: string;
  x?: number;
  z?: number;
  color?: string;
}

export interface RoomSnapshot {
  roomCode: string;
  name: string;
  hostUid: string;
  memberUids: string[];
  bankCubes: number;
  islandLevel: number;
  structures: StructuresState;
  rafts: RaftState[];
  playerProgress: Record<string, PlayerProgress>;
}

export interface LiveWorldState extends RoomSnapshot {
  players: Record<string, LivePlayerState>;
  worldCubes: WorldCube[];
  sharks: SharkEntity[];
  storms: StormCell[];
  weather: WeatherState;
  dayState: DayState;
  serverTime: number;
}

export interface RecipeDefinition {
  id: string;
  category: RecipeCategory;
  name: string;
  description: string;
  effectSummary: string;
  requiredIslandLevel: number;
  requiredPlayerLevel: number;
  maxLevel: number;
  baseCost: number;
  costMultiplier: number;
  xpReward: number;
  consumable?: boolean;
}

export const CUBE_CONFIG: Record<
  CubeTier,
  { label: string; value: number; xp: number; color: string; emissive: string; minDist: number; maxDist: number }
> = {
  base: {
    label: 'Cubo Acquamarina',
    value: 1,
    xp: 6,
    color: '#22d3ee',
    emissive: '#0891b2',
    minDist: 13,
    maxDist: 62,
  },
  rare: {
    label: 'Cubo Smeraldo',
    value: 3,
    xp: 16,
    color: '#34d399',
    emissive: '#059669',
    minDist: 48,
    maxDist: 135,
  },
  epic: {
    label: 'Cubo Ametista',
    value: 8,
    xp: 35,
    color: '#c084fc',
    emissive: '#7e22ce',
    minDist: 95,
    maxDist: 195,
  },
  solar: {
    label: 'Cubo Solare',
    value: 20,
    xp: 80,
    color: '#fbbf24',
    emissive: '#d97706',
    minDist: 140,
    maxDist: 235,
  },
};

export const RAFT_CAPACITIES = [4, 8, 14, 22, 32] as const;

export const PLAYER_COLORS = [
  '#f59e0b',
  '#06b6d4',
  '#ec4899',
  '#10b981',
  '#8b5cf6',
  '#f97316',
];

export function getRaftCapacity(level: number): number {
  const idx = Math.max(0, Math.min(RAFT_CAPACITIES.length - 1, level - 1));
  return RAFT_CAPACITIES[idx];
}

export function getIslandRadius(islandLevel: number): number {
  return 11 + (islandLevel - 1) * 2.6;
}

export function getBedPosition(islandLevel: number): { x: number; z: number } {
  const r = getIslandRadius(islandLevel);
  const angle = -2.35; // Clear grassy side opposite lighthouse and refinery
  const dist = Math.max(3.6, r * 0.36);
  return {
    x: Number((Math.cos(angle) * dist).toFixed(2)),
    z: Number((Math.sin(angle) * dist).toFixed(2)),
  };
}

export function getMarketPosition(islandLevel: number): { x: number; z: number } {
  const r = getIslandRadius(islandLevel);
  const angle = 0.72; // Sunny coastal plaza between Fabricator and Dock
  const dist = Math.max(4.8, r * 0.48);
  return {
    x: Number((Math.cos(angle) * dist).toFixed(2)),
    z: Number((Math.sin(angle) * dist).toFixed(2)),
  };
}

export function getRefineryMultiplier(refineryLevel: number): number {
  const table = [1, 1.25, 1.5, 1.85, 2.2, 2.6];
  return table[Math.max(0, Math.min(table.length - 1, refineryLevel))];
}

export function getBackpackCapacity(backpackLv: number): number {
  const table = [2, 4, 7, 10];
  return table[Math.max(0, Math.min(table.length - 1, backpackLv - 1))];
}

export function getXpForNextLevel(level: number): number {
  return Math.floor(45 * Math.pow(level, 1.45));
}

export function getPlayerLevelFromXp(xp: number): { level: number; currentXp: number; nextLevelXp: number } {
  let level = 1;
  let remaining = Math.max(0, Math.floor(xp));
  while (level < 20) {
    const req = getXpForNextLevel(level);
    if (remaining < req) {
      return { level, currentXp: remaining, nextLevelXp: req };
    }
    remaining -= req;
    level += 1;
  }
  return { level: 20, currentXp: remaining, nextLevelXp: getXpForNextLevel(20) };
}

export function computeRecipeCost(recipe: RecipeDefinition, currentLevel: number): number {
  const step = recipe.consumable ? 0 : currentLevel;
  return Math.round(recipe.baseCost * Math.pow(recipe.costMultiplier, step));
}

export const MAX_BREATH_SECONDS = 10;
export const MAX_HUNGER = 100;

export type MarketItemId = 'potion' | 'food';

export interface MarketItemDefinition {
  id: MarketItemId;
  name: string;
  description: string;
  effectSummary: string;
  cost: number;
}

export const MARKET_ITEMS: MarketItemDefinition[] = [
  {
    id: 'potion',
    name: 'Pozione Vitale',
    description: 'Elisir dell’isola che rigenera subito la tua salute riportando la Vita al massimo.',
    effectSummary: 'Ripristina 100% Vita · Tasto rapido [H]',
    cost: 5,
  },
  {
    id: 'food',
    name: 'Razione di Cibo',
    description: 'Frutta tropicale e pesce arrostito per saziare la fame durante le spedizioni.',
    effectSummary: '+50 Fame · Tasto rapido [J]',
    cost: 3,
  },
];

export function getWalkableSurfaceHeight(
  x: number,
  z: number,
  islandLevel: number,
  structures: StructuresState
): number | null {
  const r = getIslandRadius(islandLevel);
  const d = Math.hypot(x, z);

  // 1. Solid island sand/grass mound (matches buildIslandAndStructures geometry)
  if (d <= r * 0.94) {
    if (d <= r * 0.44) return 1.83;
    if (d <= r * 0.62) return 1.55;
    if (d <= r * 0.88) return 0.75;
    return 0.35;
  }

  // 2. Extended wooden dock (x in [-1.75, 1.75], z from shore to dock tip)
  if (structures.dockLevel > 0) {
    const dockLen = 6 + structures.dockLevel * 2.2;
    if (Math.abs(x) <= 1.75 && z >= r * 0.85 && z <= r + dockLen * 0.92) {
      return 0.79;
    }
  }

  // 3. Individual hexagonal sea platforms around island perimeter
  if (structures.platformLevel > 0) {
    const platCount = 2 + structures.platformLevel * 2;
    const pd = r + 2.4;
    for (let i = 0; i < platCount; i++) {
      const pa = (i / platCount) * Math.PI * 2 + 0.5;
      const px = Math.cos(pa) * pd;
      const pz = Math.sin(pa) * pd;
      if (Math.hypot(x - px, z - pz) <= 2.2) {
        return 0.49;
      }
    }
  }

  // Everywhere else is open ocean water (cannot walk on water)
  return null;
}

const WAVE_SYNC_PERIOD = 40 * Math.PI; // Exact 2π-multiple for all wave frequencies (0.05 step)

export function getSyncedWaveTime(nowMs = Date.now()): number {
  return (nowMs * 0.001) % WAVE_SYNC_PERIOD;
}

export function getWaveHeight(
  x: number,
  z: number,
  time: number,
  stormIntensity = 0,
  islandRadius = 11
): number {
  const dist = Math.hypot(x, z);
  const calm = Math.min(1, Math.max(0.08, (dist - islandRadius * 0.9) / 72));
  const w = Math.max(0, Math.min(1.35, stormIntensity));
  const sharpenMix = Math.min(1, w);

  const p1 = x * 0.068 + z * 0.025 + time * 1.15;
  const s1 = Math.sin(p1);
  const peak1 = Math.pow(Math.max(0, s1 * 0.5 + 0.5), 1.65) * 2 - 1;
  const crest1 = s1 + (peak1 - s1) * sharpenMix;

  const p2 = z * 0.082 - x * 0.032 + time * 1.45;
  const s2 = Math.cos(p2);
  const peak2 = Math.pow(Math.max(0, s2 * 0.5 + 0.5), 1.55) * 2 - 1;
  const crest2 = s2 + (peak2 - s2) * sharpenMix;

  const w3 = Math.sin((x + z) * 0.165 - time * 2.55) * (0.22 + w * 0.58);

  // Smoothstep(0.18, 1.0, w)
  const chopT = Math.max(0, Math.min(1, (w - 0.18) / 0.82));
  const chopFade = chopT * chopT * (3 - 2 * chopT);
  const stormChop =
    (Math.sin(x * 0.27 - z * 0.23 + time * 3.65) * 0.55 +
      Math.cos(x * 0.34 + z * 0.29 - time * 4.35) * 0.45) *
    chopFade *
    0.72;

  const swellAmp = (0.2 + calm * 0.58) * (1 + w * 1.65);
  return (crest1 * 0.62 + crest2 * 0.42 + w3 + stormChop) * swellAmp;
}

export const RECIPES: RecipeDefinition[] = [
  // ATTREZZI MIGLIORATI
  {
    id: 'tool_magnet_net',
    category: 'tools',
    name: 'Rete Magnetica Estesa',
    description: 'Genera un campo attrattivo che cattura i cubi galleggianti a distanza.',
    effectSummary: 'Impulso magnetico con [Spazio] · Raggio raccolta +4m per livello',
    requiredIslandLevel: 1,
    requiredPlayerLevel: 2,
    maxLevel: 3,
    baseCost: 8,
    costMultiplier: 2.1,
    xpReward: 25,
  },
  {
    id: 'tool_harpoon',
    category: 'tools',
    name: 'Arpione Repulsore',
    description: 'Spara un impulso sonico che stordisce gli squali e aggancia cubi lontani.',
    effectSummary: 'Stordisce squali entro 18m per 5s · Attira cubi in linea retta',
    requiredIslandLevel: 2,
    requiredPlayerLevel: 3,
    maxLevel: 3,
    baseCost: 18,
    costMultiplier: 2.2,
    xpReward: 40,
  },
  {
    id: 'tool_solar_lance',
    category: 'tools',
    name: 'Lancia Solare d’Onda',
    description: 'Attrezzo leggendario alimentato dai cubi solari per spedizioni estreme.',
    effectSummary: 'Raggio magnetico 22m + repulsione squali ad area + scudo scafo',
    requiredIslandLevel: 4,
    requiredPlayerLevel: 5,
    maxLevel: 3,
    baseCost: 55,
    costMultiplier: 2.2,
    xpReward: 90,
  },
  {
    id: 'craft_repair_kit',
    category: 'tools',
    name: 'Kit Riparazione Scafo',
    description: 'Patch rapida in resina marina per riparare la zattera in mare aperto.',
    effectSummary: '+1 Kit consumabile (tasto [R] ripristina 50% integrità zattera)',
    requiredIslandLevel: 1,
    requiredPlayerLevel: 1,
    maxLevel: 99,
    baseCost: 4,
    costMultiplier: 1,
    xpReward: 8,
    consumable: true,
  },

  // ZATTERE & ATTREZZATURA
  {
    id: 'raft_build_extra',
    category: 'rafts_gear',
    name: 'Fabbrica Zattera',
    description: 'Costruisci la tua prima zattera (solo 4 cubi!) o aggiungi fino a 3 imbarcazioni al molo.',
    effectSummary: '1ª Zattera: 4 cubi (4 posti) · 2ª Zattera: 35 cubi · 3ª Zattera: 80 cubi',
    requiredIslandLevel: 1,
    requiredPlayerLevel: 1,
    maxLevel: 3,
    baseCost: 4,
    costMultiplier: 1,
    xpReward: 35,
  },
  {
    id: 'raft_upgrade',
    category: 'rafts_gear',
    name: 'Potenzia Zattera (Stiva & Scafo)',
    description: 'Espande la stiva della zattera selezionata da 4 cubi fino a 32 cubi e rinforza il ponte.',
    effectSummary: 'Capacità: 4 → 8 → 14 → 22 → 32 cubi + Scafo rinforzato',
    requiredIslandLevel: 1,
    requiredPlayerLevel: 1,
    maxLevel: 5,
    baseCost: 10,
    costMultiplier: 2.35,
    xpReward: 35,
  },
  {
    id: 'raft_engine',
    category: 'rafts_gear',
    name: 'Motore Fuoribordo Turbo',
    description: 'Installa eliche idrojet sulla zattera per solcare le onde velocemente.',
    effectSummary: '+25% velocità navigazione e controllo in tempesta per livello',
    requiredIslandLevel: 2,
    requiredPlayerLevel: 2,
    maxLevel: 4,
    baseCost: 16,
    costMultiplier: 2.1,
    xpReward: 35,
  },
  {
    id: 'gear_fins',
    category: 'rafts_gear',
    name: 'Pinne Idrodinamiche',
    description: 'Aumentano la velocità a nuoto e l’agilità sulla spiaggia.',
    effectSummary: '+20% velocità movimento e nuoto per livello',
    requiredIslandLevel: 1,
    requiredPlayerLevel: 1,
    maxLevel: 4,
    baseCost: 6,
    costMultiplier: 1.9,
    xpReward: 20,
  },
  {
    id: 'gear_backpack',
    category: 'rafts_gear',
    name: 'Zaino Stagno',
    description: 'Permette di trasportare più cubi a nuoto prima di tornare alla zattera.',
    effectSummary: 'Capacità a nuoto: 2 → 4 → 7 → 10 cubi',
    requiredIslandLevel: 1,
    requiredPlayerLevel: 2,
    maxLevel: 4,
    baseCost: 9,
    costMultiplier: 2.0,
    xpReward: 22,
  },
  {
    id: 'gear_storm_suit',
    category: 'rafts_gear',
    name: 'Tuta Anti-Tempesta',
    description: 'Isolamento termico e idrodinamico contro tempeste e urti degli squali.',
    effectSummary: '-25% danni da squali e fulmini in mare aperto per livello',
    requiredIslandLevel: 3,
    requiredPlayerLevel: 3,
    maxLevel: 3,
    baseCost: 24,
    costMultiplier: 2.1,
    xpReward: 45,
  },

  // STRUTTURE ISOLA
  {
    id: 'struct_dock',
    category: 'structures',
    name: 'Molo d’Ormeggio Esteso',
    description: 'Costruisce pontili in legno con scarico automatico cubi avvicinandosi.',
    effectSummary: 'Scarico automatico zattera al molo + attracco sicuro',
    requiredIslandLevel: 2,
    requiredPlayerLevel: 1,
    maxLevel: 4,
    baseCost: 14,
    costMultiplier: 2.1,
    xpReward: 40,
  },
  {
    id: 'struct_refinery',
    category: 'structures',
    name: 'Raffineria Energetica',
    description: 'Purifica i cubi depositati moltiplicandone il valore nella cassa comune.',
    effectSummary: 'Moltiplicatore cubi: x1.25 → x1.5 → x1.85 → x2.2 → x2.6',
    requiredIslandLevel: 2,
    requiredPlayerLevel: 2,
    maxLevel: 5,
    baseCost: 20,
    costMultiplier: 2.25,
    xpReward: 55,
  },
  {
    id: 'struct_platform',
    category: 'structures',
    name: 'Piattaforme sul Mare',
    description: 'Pontoni esagonali galleggianti collegati all’isola per estendere il perimetro.',
    effectSummary: 'Aggiunge anelli di piattaforme calpestabili sul mare basso',
    requiredIslandLevel: 3,
    requiredPlayerLevel: 2,
    maxLevel: 4,
    baseCost: 26,
    costMultiplier: 2.1,
    xpReward: 50,
  },
  {
    id: 'struct_autocollector',
    category: 'structures',
    name: 'Boe & Droni Raccoglitori',
    description: 'Schiera boe magnetiche e droni automatici che raccolgono i cubi vicini.',
    effectSummary: 'Raccolta automatica passiva ogni pochi secondi (+raggio per livello)',
    requiredIslandLevel: 3,
    requiredPlayerLevel: 3,
    maxLevel: 5,
    baseCost: 30,
    costMultiplier: 2.2,
    xpReward: 65,
  },
  {
    id: 'struct_lighthouse',
    category: 'structures',
    name: 'Faro Guidarotta',
    description: 'Torre luminosa rotante che illumina le tempeste e attira cubi più preziosi.',
    effectSummary: 'Fascio guida visibile ovunque · +spawn cubi rari · calma le tempeste',
    requiredIslandLevel: 4,
    requiredPlayerLevel: 3,
    maxLevel: 4,
    baseCost: 42,
    costMultiplier: 2.2,
    xpReward: 80,
  },
  {
    id: 'struct_bay_shield',
    category: 'structures',
    name: 'Repulsore Costiero Anti-Squalo',
    description: 'Barriera sonar attorno alla baia che tiene lontani gli squali dai moli.',
    effectSummary: 'Respinge automaticamente gli squali entro 40m–75m dall’isola',
    requiredIslandLevel: 5,
    requiredPlayerLevel: 4,
    maxLevel: 4,
    baseCost: 65,
    costMultiplier: 2.2,
    xpReward: 100,
  },

  // EVOLUZIONE ISOLA
  {
    id: 'island_upgrade',
    category: 'island',
    name: 'Espandi Isola & Fabbricatore',
    description: 'Potenzia il nucleo del Fabbricatore, allarga la sabbia e sblocca nuove ricette.',
    effectSummary: '+Raggio isola, nuove palme, Fabbricatore evoluto e ricette avanzate',
    requiredIslandLevel: 1,
    requiredPlayerLevel: 1,
    maxLevel: 6,
    baseCost: 15,
    costMultiplier: 2.45,
    xpReward: 60,
  },
];

export function createInitialRaft(index = 0): RaftState {
  const angle = index * 1.4 - 0.6;
  const dist = 16;
  return {
    id: `raft-${index + 1}`,
    name: index === 0 ? 'Zattera Pioneera' : `Zattera ${index + 1}`,
    level: 1,
    capacity: getRaftCapacity(1),
    engineLevel: 0,
    hullLevel: 1,
    hp: 100,
    maxHp: 100,
    x: Math.cos(angle) * dist,
    z: Math.sin(angle) * dist,
    angle: angle + Math.PI * 0.5,
    vx: 0,
    vz: 0,
    cargo: [],
    pilotUid: null,
  };
}

export function createInitialPlayerProgress(
  uid: string,
  displayName: string,
  colorIndex = 0
): PlayerProgress {
  return {
    uid,
    displayName,
    color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
    xp: 0,
    level: 1,
    activeTool: 'net',
    tools: {
      netLv: 1,
      magnetNetLv: 0,
      harpoonLv: 0,
      solarLanceLv: 0,
    },
    gear: {
      swimSpeedLv: 1,
      backpackLv: 1,
      stormSuitLv: 0,
    },
    repairKits: 1,
    potions: 0,
    food: 0,
  };
}

export function getRaftBuildSpec(currentRaftCount: number): {
  cost: number;
  requiredIslandLevel: number;
  requiredPlayerLevel: number;
} {
  if (currentRaftCount <= 0) {
    return { cost: 4, requiredIslandLevel: 1, requiredPlayerLevel: 1 };
  }
  if (currentRaftCount === 1) {
    return { cost: 35, requiredIslandLevel: 3, requiredPlayerLevel: 2 };
  }
  return { cost: 80, requiredIslandLevel: 4, requiredPlayerLevel: 3 };
}

export function createDefaultRoomSnapshot(
  roomCode: string,
  name: string,
  hostUid: string,
  hostName: string
): RoomSnapshot {
  return {
    roomCode,
    name,
    hostUid,
    memberUids: [hostUid],
    bankCubes: 0,
    islandLevel: 1,
    structures: {
      refineryLevel: 0,
      dockLevel: 0,
      lighthouseLevel: 0,
      autoCollectorLevel: 0,
      platformLevel: 0,
      bayShieldLevel: 0,
    },
    rafts: [],
    playerProgress: {
      [hostUid]: createInitialPlayerProgress(hostUid, hostName, 0),
    },
  };
}
