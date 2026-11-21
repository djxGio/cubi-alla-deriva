import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CUBE_CONFIG,
  getBedPosition,
  getIslandRadius,
  getSyncedWaveTime,
  getWaveHeight,
  type CubeTier,
  type DayState,
  type LivePlayerState,
  type LiveWorldState,
  type RaftState,
  type SharkEntity,
  type StormCell,
  type ToolId,
  type WeatherState,
  type WorldCube,
} from '../shared/gameCatalog';
import {
  createOceanUniforms,
  createWeatherOceanMesh,
  type OceanUniforms,
} from './oceanShader';
import {
  buildIslandAndStructures,
  buildPlayerGroup,
  buildRaftGroup,
  buildSharkGroup,
  buildStormGroup,
  syncRaftCargoVisuals,
  type IslandVisualRefs,
  type PlayerVisualRefs,
  type RaftVisualRefs,
  type SharkVisualRefs,
} from './models';

// Pre-allocated scratch helpers (zero GC in 60fps loop)
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _vec3C = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _skySunny = new THREE.Color(0x93d8f8);
const _skyDusk = new THREE.Color(0xfb923c);
const _skyNight = new THREE.Color(0x0f172a);
const _skyRain = new THREE.Color(0x64748b);
const _skyStorm = new THREE.Color(0x1e293b);
const _skyFlash = new THREE.Color(0xdbeafe);
const _keyWarm = new THREE.Color(0xfff1d6);
const _keyDusk = new THREE.Color(0xfdba74);
const _keyNight = new THREE.Color(0x93c5fd);
const _keyCool = new THREE.Color(0xcbd5e1);
const _hemiSkyDay = new THREE.Color(0xe0f2fe);
const _hemiGroundDay = new THREE.Color(0x0e7490);
const _hemiSkyDusk = new THREE.Color(0xfdba74);
const _hemiGroundDusk = new THREE.Color(0x312e81);
const _hemiSkyNight = new THREE.Color(0x334155);
const _hemiGroundNight = new THREE.Color(0x082f49);
const _rimDay = new THREE.Color(0x7dd3fc);
const _rimNight = new THREE.Color(0x6366f1);
const _waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export interface InputSnapshot {
  moveX: number;
  moveZ: number;
  sprint: boolean;
}

export interface WorldHudPrompts {
  nearRaftId: string | null;
  nearFabricator: boolean;
  nearBed: boolean;
  nearDepositZone: boolean;
  distanceFromIsland: number;
  inStorm: boolean;
}

export interface ToolCastPayload {
  uid: string;
  tool: ToolId;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  radius: number;
  caughtCubes: Array<{ x: number; z: number; tier: CubeTier }>;
}

interface BurstParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  color: string;
}

interface PulseRingEffect {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxRadius: number;
}

interface HarvesterBeamEffect {
  line: THREE.Line;
  life: number;
}

interface ToolCastEffect {
  uid: string;
  tool: ToolId;
  projectile: THREE.Group;
  tether: THREE.Line;
  caughtMeshes: Array<{ mesh: THREE.Mesh; startX: number; startZ: number }>;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  radius: number;
  elapsed: number;
  outboundDur: number;
  returnDur: number;
  landed: boolean;
}

interface RainDrop {
  ox: number;
  oy: number;
  oz: number;
  speed: number;
}

export class WorldEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private keyOffset = new THREE.Vector3(38, 62, 32);
  private fog: THREE.FogExp2;
  private skyColor: THREE.Color;
  private isSoftwareGl: boolean;
  private frameId = 0;
  private disposed = false;

  private oceanUniforms: OceanUniforms = createOceanUniforms();

  private islandRefs: IslandVisualRefs | null = null;
  private lastIslandKey = '';

  private raftVisuals = new Map<string, RaftVisualRefs>();
  private playerVisuals = new Map<string, PlayerVisualRefs>();
  private sharkVisuals = new Map<string, SharkVisualRefs>();
  private stormVisuals = new Map<string, THREE.Group>();

  private cubeInstancedMesh: THREE.InstancedMesh;
  private worldCubes: WorldCube[] = [];
  private MAX_CUBES = 140;

  private particleInstancedMesh: THREE.InstancedMesh;
  private particles: BurstParticle[] = [];
  private MAX_PARTICLES = 90;

  private rainInstancedMesh: THREE.InstancedMesh;
  private rainDrops: RainDrop[] = [];
  private MAX_RAIN = 260;

  private aimReticle: THREE.Mesh;
  private aimPos = new THREE.Vector3();
  private hasAim = false;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();

  private pulseEffects: PulseRingEffect[] = [];
  private beamEffects: HarvesterBeamEffect[] = [];
  private castEffects: ToolCastEffect[] = [];

  private weatherState: WeatherState = { phase: 'sunny', intensity: 0, nextChangeInSec: 45 };
  private dayState: DayState = { day: 1, timeOfDay: 0.14, cycleDurationSec: 90 };
  private smoothWeatherIntensity = 0;
  private lightningFlash = 0;
  private nextLightningTimer = 3.5;

  private heldKeys = new Set<string>();
  private localUid = '';
  private cameraYaw = 0;
  private cameraZoom = 1;
  private cameraShake = 0;
  private cameraPos = new THREE.Vector3(0, 18, 28);
  private cameraLook = new THREE.Vector3(0, 1.5, 0);

  private latestState: LiveWorldState | null = null;
  private lastTimeMs = performance.now();
  private onPromptChange?: (prompts: WorldHudPrompts) => void;
  private onCastTool?: (targetX: number, targetZ: number) => void;
  private lastPromptHash = '';

  public isTitleMode = true;

  constructor(
    container: HTMLElement,
    onPromptChange?: (prompts: WorldHudPrompts) => void,
    onCastTool?: (targetX: number, targetZ: number) => void
  ) {
    this.container = container;
    this.onPromptChange = onPromptChange;
    this.onCastTool = onCastTool;

    // Software WebGL guard
    this.isSoftwareGl = (() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.skyColor = _skySunny.clone();
    this.scene.background = this.skyColor;
    this.fog = new THREE.FogExp2(0x93d8f8, 0.0038);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(
      52,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.5,
      550
    );
    this.camera.position.copy(this.cameraPos);

    // Mandatory studio environment map on every device
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Warm/cool 3-point lighting rig
    this.hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x0e7490, 0.85);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff1d6, 2.15);
    this.keyLight.position.set(42, 62, 34);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.left = -45;
    this.keyLight.shadow.camera.right = 45;
    this.keyLight.shadow.camera.top = 45;
    this.keyLight.shadow.camera.bottom = -45;
    this.keyLight.shadow.camera.near = 5;
    this.keyLight.shadow.camera.far = 180;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.65);
    this.rimLight.position.set(-45, 25, -45);
    this.scene.add(this.rimLight);

    // Ocean mesh with dynamic weather-reactive wave shader
    this.scene.add(createWeatherOceanMesh(this.oceanUniforms));

    // Instanced floating cubes
    const cubeGeo = new THREE.BoxGeometry(0.92, 0.92, 0.92);
    const cubeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.18,
      metalness: 0.2,
    });
    this.cubeInstancedMesh = new THREE.InstancedMesh(cubeGeo, cubeMat, this.MAX_CUBES);
    this.cubeInstancedMesh.count = 0;
    this.cubeInstancedMesh.frustumCulled = false;
    this.cubeInstancedMesh.castShadow = true;
    this.scene.add(this.cubeInstancedMesh);

    // Pooled burst particles
    const partGeo = new THREE.OctahedronGeometry(0.22, 0);
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleInstancedMesh = new THREE.InstancedMesh(partGeo, partMat, this.MAX_PARTICLES);
    this.particleInstancedMesh.count = 0;
    this.particleInstancedMesh.frustumCulled = false;
    this.scene.add(this.particleInstancedMesh);
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.6,
        color: '#fbbf24',
      });
    }

    // Dynamic rain streaks instanced mesh
    const rainGeo = new THREE.BoxGeometry(0.04, 1.55, 0.04);
    const rainMat = new THREE.MeshBasicMaterial({
      color: 0xcbe7ff,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.rainInstancedMesh = new THREE.InstancedMesh(rainGeo, rainMat, this.MAX_RAIN);
    this.rainInstancedMesh.count = 0;
    this.rainInstancedMesh.frustumCulled = false;
    this.scene.add(this.rainInstancedMesh);
    for (let i = 0; i < this.MAX_RAIN; i++) {
      this.rainDrops.push({
        ox: (Math.random() - 0.5) * 64,
        oy: Math.random() * 26,
        oz: (Math.random() - 0.5) * 64,
        speed: 26 + Math.random() * 14,
      });
    }

    // Water aim reticle for throwing net / harpoon
    const reticleGeo = new THREE.RingGeometry(1.1, 1.45, 28);
    reticleGeo.rotateX(-Math.PI / 2);
    this.aimReticle = new THREE.Mesh(
      reticleGeo,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.aimReticle.visible = false;
    this.scene.add(this.aimReticle);

    // Default sunny title-screen island preview
    this.rebuildIslandIfNeeded(1, {
      refineryLevel: 0,
      dockLevel: 0,
      lighthouseLevel: 0,
      autoCollectorLevel: 0,
      platformLevel: 0,
      bayShieldLevel: 0,
    });

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.startLoop();
  }

  private bindEvents() {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    this.renderer.domElement.addEventListener('wheel', this.handleWheel, { passive: true });
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.handlePointerLeave);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
  }

  private raycastWater(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(_waterPlane, hit) ? hit : null;
  }

  private handlePointerMove = (e: PointerEvent) => {
    if (this.isTitleMode) {
      this.hasAim = false;
      this.aimReticle.visible = false;
      return;
    }
    const hit = this.raycastWater(e.clientX, e.clientY);
    if (hit) {
      this.aimPos.copy(hit);
      this.hasAim = true;
    } else {
      this.hasAim = false;
    }
  };

  private handlePointerLeave = () => {
    this.hasAim = false;
    this.aimReticle.visible = false;
  };

  private handlePointerDown = (e: PointerEvent) => {
    if (this.isTitleMode || e.button !== 0 || !this.onCastTool) return;
    const hit = this.raycastWater(e.clientX, e.clientY);
    if (hit) {
      this.aimPos.copy(hit);
      this.hasAim = true;
      this.onCastTool(hit.x, hit.z);
    }
  };

  private handleResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    this.heldKeys.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.code);
  };

  private handleWindowBlur = () => {
    this.heldKeys.clear();
  };

  private handleWheel = (e: WheelEvent) => {
    this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom + e.deltaY * 0.0008, 0.72, 1.65);
  };

  public adjustZoom(delta: number) {
    this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom + delta, 0.72, 1.65);
  }

  public rotateCameraYaw(delta: number) {
    this.cameraYaw += delta;
  }

  public getAimPoint(): { x: number; z: number } | null {
    return this.hasAim ? { x: this.aimPos.x, z: this.aimPos.z } : null;
  }

  public getInputVector(): InputSnapshot {
    let rawX = 0;
    let rawZ = 0;
    if (this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp')) rawZ -= 1;
    if (this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown')) rawZ += 1;
    if (this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft')) rawX -= 1;
    if (this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight')) rawX += 1;

    if (this.heldKeys.has('KeyQ')) this.cameraYaw += 0.03;
    if (this.heldKeys.has('KeyC')) this.cameraYaw -= 0.03;

    const cos = Math.cos(this.cameraYaw);
    const sin = Math.sin(this.cameraYaw);
    const moveX = rawX * cos + rawZ * sin;
    const moveZ = -rawX * sin + rawZ * cos;

    return {
      moveX,
      moveZ,
      sprint: this.heldKeys.has('ShiftLeft') || this.heldKeys.has('ShiftRight'),
    };
  }

  public setLocalUid(uid: string) {
    this.localUid = uid;
  }

  public applyFullState(state: LiveWorldState) {
    this.latestState = state;
    this.worldCubes = state.worldCubes || [];
    if (state.weather) {
      this.weatherState = { ...state.weather };
    }
    if (state.dayState) {
      this.dayState = { ...state.dayState };
    }
    this.rebuildIslandIfNeeded(state.islandLevel, state.structures);
    this.syncRafts(state.rafts);
    this.syncPlayers(state.players);
    this.syncSharks(state.sharks);
    this.syncStorms(state.storms);
  }

  public applySnapshotUpdate(snap: Partial<LiveWorldState>) {
    if (!this.latestState) return;
    Object.assign(this.latestState, snap);
    if (snap.islandLevel !== undefined || snap.structures !== undefined) {
      this.rebuildIslandIfNeeded(this.latestState.islandLevel, this.latestState.structures);
    }
    if (snap.rafts) {
      this.syncRafts(snap.rafts);
    }
  }

  public applyTick(tick: {
    players: Record<string, LivePlayerState>;
    rafts: Array<{ id: string; x: number; z: number; angle: number; hp: number; maxHp: number; cargo: CubeTier[]; pilotUid: string | null }>;
    sharks: Array<{ id: string; x: number; z: number; angle: number; state: SharkEntity['state'] }>;
    storms: StormCell[];
    weather?: WeatherState;
    dayState?: DayState;
    worldCubes?: WorldCube[];
  }) {
    if (!this.latestState) return;
    this.latestState.players = tick.players;
    for (const rTick of tick.rafts) {
      const existing = this.latestState.rafts.find((r) => r.id === rTick.id);
      if (existing) {
        existing.x = rTick.x;
        existing.z = rTick.z;
        existing.angle = rTick.angle;
        existing.hp = rTick.hp;
        existing.maxHp = rTick.maxHp;
        existing.cargo = rTick.cargo;
        existing.pilotUid = rTick.pilotUid;
      }
    }
    for (const sTick of tick.sharks) {
      const existing = this.latestState.sharks.find((s) => s.id === sTick.id);
      if (existing) {
        existing.x = sTick.x;
        existing.z = sTick.z;
        existing.angle = sTick.angle;
        existing.state = sTick.state;
      }
    }
    this.latestState.storms = tick.storms;
    if (tick.weather) {
      this.weatherState = tick.weather;
      this.latestState.weather = tick.weather;
    }
    if (tick.dayState) {
      this.dayState = tick.dayState;
      this.latestState.dayState = tick.dayState;
    }
    if (tick.worldCubes) {
      this.worldCubes = tick.worldCubes;
      this.latestState.worldCubes = tick.worldCubes;
    }
  }

  public spawnBurst(x: number, y: number, z: number, color: string, count = 14) {
    let spawned = 0;
    for (const p of this.particles) {
      if (!p.active && spawned < count) {
        p.active = true;
        p.x = x;
        p.y = y;
        p.z = z;
        const a = Math.random() * Math.PI * 2;
        const spd = 2.5 + Math.random() * 4.5;
        p.vx = Math.cos(a) * spd;
        p.vy = 3.5 + Math.random() * 4.5;
        p.vz = Math.sin(a) * spd;
        p.life = 0;
        p.maxLife = 0.45 + Math.random() * 0.3;
        p.color = color;
        spawned++;
      }
    }
  }

  public spawnToolPulse(x: number, z: number, radius: number, tool: ToolId) {
    const color =
      tool === 'solar_lance' ? 0xfbbf24 : tool === 'harpoon' ? 0x38bdf8 : 0x22d3ee;
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1.0, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.55, z);
    this.scene.add(mesh);
    this.pulseEffects.push({ mesh, life: 0, maxLife: 0.45, maxRadius: radius });
  }

  public spawnToolCast(payload: ToolCastPayload) {
    const projGroup = new THREE.Group();
    if (payload.tool === 'harpoon' || payload.tool === 'solar_lance') {
      const tipCol = payload.tool === 'solar_lance' ? 0xfbbf24 : 0x38bdf8;
      const spear = new THREE.Mesh(
        new THREE.ConeGeometry(0.24, 1.35, 6),
        new THREE.MeshStandardMaterial({ color: tipCol, emissive: tipCol, emissiveIntensity: 0.4, roughness: 0.25 })
      );
      spear.rotation.x = Math.PI / 2;
      projGroup.add(spear);
    } else {
      const hoopCol = payload.tool === 'magnet_net' ? 0x22d3ee : 0xd97706;
      const hoop = new THREE.Mesh(
        new THREE.TorusGeometry(0.85, 0.1, 8, 18),
        new THREE.MeshStandardMaterial({ color: hoopCol, roughness: 0.45 })
      );
      hoop.rotation.x = Math.PI / 2;
      projGroup.add(hoop);
      const netDisc = new THREE.Mesh(
        new THREE.CircleGeometry(0.82, 12),
        new THREE.MeshBasicMaterial({
          color: payload.tool === 'magnet_net' ? 0x67e8f9 : 0xfef3c7,
          wireframe: true,
          transparent: true,
          opacity: 0.85,
        })
      );
      netDisc.rotation.x = -Math.PI / 2;
      projGroup.add(netDisc);
    }
    projGroup.position.set(payload.fromX, 1.5, payload.fromZ);
    projGroup.lookAt(payload.toX, 1.5, payload.toZ);
    this.scene.add(projGroup);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(payload.fromX, 1.5, payload.fromZ),
      new THREE.Vector3(payload.fromX, 1.5, payload.fromZ),
    ]);
    const tether = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({
        color: payload.tool === 'solar_lance' ? 0xfbbf24 : 0xe2e8f0,
        transparent: true,
        opacity: 0.78,
      })
    );
    this.scene.add(tether);

    const caughtMeshes = (payload.caughtCubes || []).map((c) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.86, 0.86, 0.86),
        new THREE.MeshStandardMaterial({
          color: CUBE_CONFIG[c.tier].color,
          emissive: CUBE_CONFIG[c.tier].emissive,
          emissiveIntensity: 0.35,
          roughness: 0.2,
        })
      );
      m.position.set(c.x, 0.5, c.z);
      m.visible = false;
      this.scene.add(m);
      return { mesh: m, startX: c.x, startZ: c.z };
    });

    this.castEffects.push({
      uid: payload.uid,
      tool: payload.tool,
      projectile: projGroup,
      tether,
      caughtMeshes,
      fromX: payload.fromX,
      fromZ: payload.fromZ,
      toX: payload.toX,
      toZ: payload.toZ,
      radius: payload.radius,
      elapsed: 0,
      outboundDur: 0.24,
      returnDur: 0.24,
      landed: false,
    });
  }

  public spawnHarvesterBeam(x: number, z: number) {
    const islandR = this.latestState ? getIslandRadius(this.latestState.islandLevel) : 11;
    const pts = [new THREE.Vector3(0, 4.4, 0), new THREE.Vector3(x, 0.6, z)];
    if (Math.hypot(x, z) > islandR + 4) {
      pts[0].set(x * 0.45, 3.8, z * 0.45);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.beamEffects.push({ line, life: 0.32 });
    this.spawnBurst(x, 0.7, z, '#22d3ee', 8);
  }

  public triggerShake(amount = 0.55) {
    this.cameraShake = Math.min(1.2, this.cameraShake + amount);
  }

  private rebuildIslandIfNeeded(islandLevel: number, structures: LiveWorldState['structures']) {
    const key = `${islandLevel}:${JSON.stringify(structures)}`;
    if (key === this.lastIslandKey) return;
    this.lastIslandKey = key;
    this.oceanUniforms.uIslandRadius.value = getIslandRadius(islandLevel);

    if (this.islandRefs) {
      this.scene.remove(this.islandRefs.group);
    }
    this.islandRefs = buildIslandAndStructures(islandLevel, structures);
    this.scene.add(this.islandRefs.group);
    this.spawnBurst(0, 3.2, 0, '#fbbf24', 22);
  }

  private syncRafts(rafts: RaftState[]) {
    const activeIds = new Set(rafts.map((r) => r.id));
    for (const [id, refs] of this.raftVisuals.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(refs.group);
        this.raftVisuals.delete(id);
      }
    }
    for (const raft of rafts) {
      const existing = this.raftVisuals.get(raft.id);
      if (
        !existing ||
        existing.level !== raft.level ||
        existing.engineLevel !== raft.engineLevel ||
        existing.capacity !== raft.capacity
      ) {
        if (existing) this.scene.remove(existing.group);
        const built = buildRaftGroup(raft);
        built.group.position.set(raft.x, 0.2, raft.z);
        built.group.rotation.y = raft.angle;
        syncRaftCargoVisuals(built, raft.cargo);
        this.scene.add(built.group);
        this.raftVisuals.set(raft.id, built);
      } else {
        syncRaftCargoVisuals(existing, raft.cargo);
      }
    }
  }

  private syncPlayers(players: Record<string, LivePlayerState>) {
    const activeUids = new Set(Object.keys(players));
    for (const [uid, refs] of this.playerVisuals.entries()) {
      if (!activeUids.has(uid)) {
        this.scene.remove(refs.group);
        this.playerVisuals.delete(uid);
      }
    }
    for (const [uid, p] of Object.entries(players)) {
      let refs = this.playerVisuals.get(uid);
      if (!refs) {
        refs = buildPlayerGroup(p.color, p.activeTool);
        refs.group.position.set(p.x, p.y, p.z);
        this.scene.add(refs.group);
        this.playerVisuals.set(uid, refs);
      }
      if (refs.activeTool !== p.activeTool) {
        refs.activeTool = p.activeTool;
        for (const [tid, tGroup] of Object.entries(refs.toolMeshes) as [ToolId, THREE.Group][]) {
          tGroup.visible = tid === p.activeTool;
        }
      }
    }
  }

  private syncSharks(sharks: SharkEntity[]) {
    for (const shark of sharks) {
      if (!this.sharkVisuals.has(shark.id)) {
        const refs = buildSharkGroup();
        refs.group.position.set(shark.x, 0.1, shark.z);
        this.scene.add(refs.group);
        this.sharkVisuals.set(shark.id, refs);
      }
    }
  }

  private syncStorms(storms: StormCell[]) {
    for (const st of storms) {
      if (!this.stormVisuals.has(st.id)) {
        const grp = buildStormGroup(st.radius);
        grp.position.set(st.x, 0, st.z);
        this.scene.add(grp);
        this.stormVisuals.set(st.id, grp);
      }
    }
  }

  private startLoop() {
    const afterDraw = (cb: () => void) => {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (this.disposed) return;
      const now = performance.now();
      const rawDt = (now - this.lastTimeMs) / 1000;
      this.lastTimeMs = now;
      const dt = Math.min(rawDt, 0.05);

      this.updateScene(dt, now * 0.001);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.frameId = window.setTimeout(tick, 16);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private updateWeatherVisuals(dt: number, localPlayer?: LivePlayerState, state?: LiveWorldState | null) {
    const target = this.isTitleMode ? 0 : this.weatherState.intensity;
    this.smoothWeatherIntensity = THREE.MathUtils.lerp(
      this.smoothWeatherIntensity,
      target,
      1 - Math.exp(-1.5 * dt)
    );
    const w = this.smoothWeatherIntensity;
    this.oceanUniforms.uWeatherIntensity.value = w;

    // Lightning flashes during heavy storm
    if (w > 0.72 && !this.isTitleMode) {
      this.nextLightningTimer -= dt;
      if (this.nextLightningTimer <= 0) {
        this.lightningFlash = 1.0;
        this.nextLightningTimer = 4.2 + Math.random() * 5.8;
      }
    }
    this.lightningFlash = Math.max(0, this.lightningFlash - dt * 5.2);

    // Day/Dusk/Night sky, celestial arc & lighting baseline (keep title mode bright sunny)
    const tod = this.isTitleMode ? 0.25 : this.dayState.timeOfDay;
    let nightFactor = 0;
    if (tod < 0.1) {
      const u = tod / 0.1;
      this.skyColor.copy(_skyDusk).lerp(_skySunny, u);
      this.keyLight.color.copy(_keyDusk).lerp(_keyWarm, u);
      this.hemiLight.color.copy(_hemiSkyDusk).lerp(_hemiSkyDay, u);
      this.hemiLight.groundColor.copy(_hemiGroundDusk).lerp(_hemiGroundDay, u);
      this.rimLight.color.copy(_rimNight).lerp(_rimDay, u);
      nightFactor = (1 - u) * 0.25;
    } else if (tod < 0.62) {
      this.skyColor.copy(_skySunny);
      this.keyLight.color.copy(_keyWarm);
      this.hemiLight.color.copy(_hemiSkyDay);
      this.hemiLight.groundColor.copy(_hemiGroundDay);
      this.rimLight.color.copy(_rimDay);
      nightFactor = 0;
    } else if (tod < 0.78) {
      const u = (tod - 0.62) / 0.16;
      this.skyColor.copy(_skySunny).lerp(_skyDusk, u);
      this.keyLight.color.copy(_keyWarm).lerp(_keyDusk, u);
      this.hemiLight.color.copy(_hemiSkyDay).lerp(_hemiSkyDusk, u);
      this.hemiLight.groundColor.copy(_hemiGroundDay).lerp(_hemiGroundDusk, u);
      this.rimLight.color.copy(_rimDay).lerp(_rimNight, u * 0.45);
      nightFactor = u * 0.35;
    } else if (tod < 0.85) {
      const u = (tod - 0.78) / 0.07;
      this.skyColor.copy(_skyDusk).lerp(_skyNight, u);
      this.keyLight.color.copy(_keyDusk).lerp(_keyNight, u);
      this.hemiLight.color.copy(_hemiSkyDusk).lerp(_hemiSkyNight, u);
      this.hemiLight.groundColor.copy(_hemiGroundDusk).lerp(_hemiGroundNight, u);
      this.rimLight.color.copy(_rimDay).lerp(_rimNight, 0.45 + u * 0.55);
      nightFactor = 0.35 + u * 0.65;
    } else if (tod < 0.95) {
      this.skyColor.copy(_skyNight);
      this.keyLight.color.copy(_keyNight);
      this.hemiLight.color.copy(_hemiSkyNight);
      this.hemiLight.groundColor.copy(_hemiGroundNight);
      this.rimLight.color.copy(_rimNight);
      nightFactor = 1;
    } else {
      const u = (tod - 0.95) / 0.05;
      this.skyColor.copy(_skyNight).lerp(_skyDusk, u);
      this.keyLight.color.copy(_keyNight).lerp(_keyDusk, u);
      this.hemiLight.color.copy(_hemiSkyNight).lerp(_hemiSkyDusk, u);
      this.hemiLight.groundColor.copy(_hemiGroundNight).lerp(_hemiGroundDusk, u);
      this.rimLight.color.copy(_rimNight).lerp(_rimDay, u * 0.3);
      nightFactor = 1 - u * 0.75;
    }

    // Dynamic Sun / Moon celestial arc offset for DirectionalLight shadows
    if (tod < 0.78) {
      const sunProg = tod / 0.78; // 0 (dawn east) -> 0.5 (noon) -> 1 (dusk west)
      const elevationAngle = sunProg * Math.PI;
      this.keyOffset.set(
        Math.cos(elevationAngle) * 58,
        16 + Math.sin(elevationAngle) * 54,
        28
      );
    } else {
      const moonProg = (tod - 0.78) / 0.22;
      const moonAngle = moonProg * Math.PI;
      this.keyOffset.set(
        -Math.cos(moonAngle) * 44,
        24 + Math.sin(moonAngle) * 34,
        -26
      );
    }

    // Weather sky transition layered on top of day-night color
    if (w > 0.01) {
      if (w <= 0.45) {
        this.skyColor.lerp(_skyRain, (w / 0.45) * 0.78);
      } else {
        this.skyColor.lerp(_skyRain, 0.78).lerp(_skyStorm, (w - 0.45) / 0.55);
      }
      this.keyLight.color.lerp(_keyCool, w * 0.8);
    }
    if (this.lightningFlash > 0.02) {
      this.skyColor.lerp(_skyFlash, this.lightningFlash * 0.65);
    }
    this.fog.color.copy(this.skyColor);

    // Fog density scales with weather + open sea distance (lighthouse softens fog)
    const dist = localPlayer ? Math.hypot(localPlayer.x, localPlayer.z) : 0;
    const openSea = THREE.MathUtils.clamp((dist - 22) / 90, 0, 1);
    const lhLevel = state?.structures.lighthouseLevel || 0;
    const baseDensity =
      w <= 0.45
        ? THREE.MathUtils.lerp(0.0038, 0.0072, w / 0.45)
        : THREE.MathUtils.lerp(0.0072, 0.0155, (w - 0.45) / 0.55);
    const openSeaExtra = openSea * w * 0.0048;
    const lighthouseClear = Math.min(baseDensity * 0.4, lhLevel * 0.0012);
    this.fog.density = Math.max(0.0032, baseDensity + nightFactor * 0.0016 + openSeaExtra - lighthouseClear);

    // Sync night factor & active storm cell uniforms to ocean shader
    this.oceanUniforms.uNightFactor.value = nightFactor;
    const stormUniforms = this.oceanUniforms.uStormCells.value;
    const activeStorms = !this.isTitleMode && state?.storms ? state.storms : [];
    for (let i = 0; i < stormUniforms.length; i++) {
      const cell = activeStorms[i];
      if (cell) {
        stormUniforms[i].set(cell.x, cell.z, cell.radius, 1);
      } else {
        stormUniforms[i].set(0, 0, 20, 0);
      }
    }

    // Island camp lantern & lighthouse glow boost at night
    if (this.islandRefs) {
      if (this.islandRefs.bedLanternLight) {
        this.islandRefs.bedLanternLight.intensity = 0.2 + nightFactor * 2.5;
      }
      if (this.islandRefs.bedLanternMat) {
        this.islandRefs.bedLanternMat.emissiveIntensity = 0.85 + nightFactor * 1.65;
      }
      if (this.islandRefs.lighthouseBeamMat) {
        this.islandRefs.lighthouseBeamMat.opacity = 0.1 + nightFactor * 0.28 + w * 0.08;
      }
    }

    // Key, rim & hemisphere lighting modulation (always readable at night)
    const nightHemi = THREE.MathUtils.lerp(0.85, 0.48, nightFactor);
    const nightKey = THREE.MathUtils.lerp(2.15, 0.88, nightFactor);
    this.hemiLight.intensity = THREE.MathUtils.lerp(nightHemi, 0.44, w) + this.lightningFlash * 0.5;
    this.keyLight.intensity = THREE.MathUtils.lerp(nightKey, 0.72, w) + this.lightningFlash * 2.4;
    this.rimLight.intensity = THREE.MathUtils.lerp(0.65, 0.45, nightFactor) * (1 - w * 0.35);

    // Rain particle streaks around camera look point
    const activeRain = w > 0.08 ? Math.floor(this.MAX_RAIN * Math.min(1, w)) : 0;
    this.rainInstancedMesh.count = activeRain;
    if (activeRain > 0) {
      const windTilt = 0.24 * w;
      for (let i = 0; i < activeRain; i++) {
        const drop = this.rainDrops[i];
        drop.oy -= drop.speed * (0.85 + w * 0.45) * dt;
        drop.ox += drop.speed * windTilt * 0.5 * dt;
        if (drop.oy < -1) {
          drop.oy = 24 + Math.random() * 4;
          drop.ox = (Math.random() - 0.5) * 64;
          drop.oz = (Math.random() - 0.5) * 64;
        }
        _dummy.position.set(
          this.cameraLook.x + drop.ox,
          drop.oy,
          this.cameraLook.z + drop.oz
        );
        _dummy.rotation.set(0, 0, -windTilt);
        _dummy.scale.set(1, 0.75 + w * 0.65, 1);
        _dummy.updateMatrix();
        this.rainInstancedMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.rainInstancedMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private getLocalWaveWeather(x: number, z: number, baseWeather: number, state?: LiveWorldState | null): number {
    if (this.isTitleMode || !state?.storms?.length) return baseWeather;
    let boost = 0;
    for (const cell of state.storms) {
      const d = Math.hypot(x - cell.x, z - cell.z);
      const maxD = cell.radius * 1.4;
      if (d < maxD) {
        const t = 1 - d / maxD;
        boost += t * t * (3 - 2 * t) * 0.62;
      }
    }
    return Math.min(1.35, baseWeather + boost);
  }

  private updateScene(dt: number, elapsed: number) {
    const tSec = getSyncedWaveTime();
    this.oceanUniforms.uTime.value = tSec;
    this.oceanUniforms.uDetailTime.value = elapsed;

    const state = this.latestState;
    const localPlayer = state?.players?.[this.localUid];
    this.updateWeatherVisuals(dt, localPlayer, state);

    const wInt = this.smoothWeatherIntensity;
    const islandR = state ? getIslandRadius(state.islandLevel) : 11;

    // Island animated structures
    if (this.islandRefs) {
      this.islandRefs.fabricatorCrystal.rotation.y += dt * 1.1;
      this.islandRefs.fabricatorCrystal.position.y = 2.65 + Math.sin(elapsed * 2.4) * 0.14;
      this.islandRefs.fabricatorRing.rotation.x = Math.sin(elapsed * 0.9) * 0.55;
      this.islandRefs.fabricatorRing.rotation.y += dt * 0.85;
      if (this.islandRefs.refineryTurbine) {
        this.islandRefs.refineryTurbine.rotation.z += dt * 3.2;
      }
      if (this.islandRefs.lighthouseBeam) {
        this.islandRefs.lighthouseBeam.rotation.y += dt * 0.9;
      }
      this.islandRefs.drones.forEach((d, idx) => {
        d.position.y = 3.1 + Math.sin(elapsed * 2.5 + idx) * 0.35;
        d.rotation.y += dt * 1.6;
      });
    }

    if (state) {
      this.syncRafts(state.rafts);
      this.syncPlayers(state.players);

      // Smoothly interpolate rafts on wave surface + tilt with real wave slopes
      for (const raft of state.rafts) {
        const refs = this.raftVisuals.get(raft.id);
        if (!refs) continue;
        const damp = 1 - Math.exp(-12 * dt);
        refs.group.position.x = THREE.MathUtils.lerp(refs.group.position.x, raft.x, damp);
        refs.group.position.z = THREE.MathUtils.lerp(refs.group.position.z, raft.z, damp);
        const rx = refs.group.position.x;
        const rz = refs.group.position.z;
        const localW = this.getLocalWaveWeather(rx, rz, wInt, state);
        const waveY = getWaveHeight(rx, rz, tSec, localW, islandR);
        const slopeX = (getWaveHeight(rx + 1.2, rz, tSec, localW, islandR) - getWaveHeight(rx - 1.2, rz, tSec, localW, islandR)) / 2.4;
        const slopeZ = (getWaveHeight(rx, rz + 1.2, tSec, localW, islandR) - getWaveHeight(rx, rz - 1.2, tSec, localW, islandR)) / 2.4;

        refs.group.position.y = THREE.MathUtils.lerp(refs.group.position.y, waveY + 0.08, damp);
        refs.group.rotation.y = this.lerpAngle(refs.group.rotation.y, raft.angle, damp);

        const sinY = Math.sin(refs.group.rotation.y);
        const cosY = Math.cos(refs.group.rotation.y);
        const localPitch = -(slopeX * sinY + slopeZ * cosY) * 0.72;
        const localRoll = -(slopeX * cosY - slopeZ * sinY) * 0.72;
        refs.group.rotation.x = THREE.MathUtils.lerp(refs.group.rotation.x, localPitch, damp);
        refs.group.rotation.z = THREE.MathUtils.lerp(refs.group.rotation.z, localRoll, damp);
        if (refs.propeller && raft.pilotUid) {
          refs.propeller.rotation.z += dt * 18;
        }
      }

      // Smoothly interpolate players & limb walk/swim cycle
      for (const [uid, p] of Object.entries(state.players)) {
        const refs = this.playerVisuals.get(uid);
        if (!refs) continue;
        const damp = 1 - Math.exp(-15 * dt);
        const prevX = refs.group.position.x;
        const prevZ = refs.group.position.z;
        refs.group.position.x = THREE.MathUtils.lerp(prevX, p.x, damp);
        refs.group.position.y = THREE.MathUtils.lerp(refs.group.position.y, p.y, damp);
        refs.group.position.z = THREE.MathUtils.lerp(prevZ, p.z, damp);
        refs.group.rotation.y = this.lerpAngle(refs.group.rotation.y, p.angle, damp);

        const moveSpeed = Math.hypot(refs.group.position.x - prevX, refs.group.position.z - prevZ) / Math.max(0.001, dt);
        if (p.mode === 'piloting') {
          refs.group.rotation.x = THREE.MathUtils.lerp(refs.group.rotation.x, 0, damp);
          refs.leftLeg.rotation.x = 0.25;
          refs.rightLeg.rotation.x = 0.25;
          refs.leftArm.rotation.x = -0.5;
          refs.rightArm.rotation.x = -0.35;
        } else if (p.mode === 'swimming') {
          const isMoving = moveSpeed > 0.35;
          const targetPitch = isMoving ? 1.05 : 0.24;
          refs.group.rotation.x = THREE.MathUtils.lerp(refs.group.rotation.x, targetPitch, damp);
          const stroke = Math.sin(elapsed * (isMoving ? 11 : 5));
          refs.leftLeg.rotation.x = stroke * (isMoving ? 0.65 : 0.35);
          refs.rightLeg.rotation.x = -stroke * (isMoving ? 0.65 : 0.35);
          refs.leftArm.rotation.x = -0.95 + stroke * (isMoving ? 0.95 : 0.35);
          refs.rightArm.rotation.x = -0.95 - stroke * (isMoving ? 0.95 : 0.35);
        } else if (moveSpeed > 0.35) {
          refs.group.rotation.x = THREE.MathUtils.lerp(refs.group.rotation.x, 0, damp);
          const swing = Math.sin(elapsed * 11) * 0.55;
          refs.leftLeg.rotation.x = swing;
          refs.rightLeg.rotation.x = -swing;
          refs.leftArm.rotation.x = -swing * 0.8;
          refs.rightArm.rotation.x = swing * 0.6;
        } else {
          refs.group.rotation.x = THREE.MathUtils.lerp(refs.group.rotation.x, 0, damp);
          refs.leftLeg.rotation.x = THREE.MathUtils.lerp(refs.leftLeg.rotation.x, 0, damp);
          refs.rightLeg.rotation.x = THREE.MathUtils.lerp(refs.rightLeg.rotation.x, 0, damp);
          refs.leftArm.rotation.x = THREE.MathUtils.lerp(refs.leftArm.rotation.x, 0, damp);
          refs.rightArm.rotation.x = THREE.MathUtils.lerp(refs.rightArm.rotation.x, 0, damp);
        }
      }

      // Sharks
      for (const shark of state.sharks) {
        const refs = this.sharkVisuals.get(shark.id);
        if (!refs) continue;
        const damp = 1 - Math.exp(-10 * dt);
        refs.group.position.x = THREE.MathUtils.lerp(refs.group.position.x, shark.x, damp);
        refs.group.position.z = THREE.MathUtils.lerp(refs.group.position.z, shark.z, damp);
        const localW = this.getLocalWaveWeather(refs.group.position.x, refs.group.position.z, wInt, state);
        refs.group.position.y = getWaveHeight(refs.group.position.x, refs.group.position.z, tSec, localW, islandR) - 0.12;
        refs.group.rotation.y = this.lerpAngle(refs.group.rotation.y, shark.angle, damp);
        refs.tail.rotation.y = Math.sin(elapsed * (shark.state === 'chase' ? 14 : 7)) * 0.42;
      }

      // Storms
      for (const st of state.storms) {
        const grp = this.stormVisuals.get(st.id);
        if (!grp) continue;
        const damp = 1 - Math.exp(-5 * dt);
        grp.position.x = THREE.MathUtils.lerp(grp.position.x, st.x, damp);
        grp.position.z = THREE.MathUtils.lerp(grp.position.z, st.z, damp);
        grp.rotation.y += dt * 0.15;
      }
    }

    // Instanced floating cubes update
    const cubeCount = Math.min(this.MAX_CUBES, this.worldCubes.length);
    this.cubeInstancedMesh.count = cubeCount;
    for (let i = 0; i < cubeCount; i++) {
      const c = this.worldCubes[i];
      const localW = this.getLocalWaveWeather(c.x, c.z, wInt, state);
      const waveY = getWaveHeight(c.x, c.z, tSec, localW, islandR);
      _dummy.position.set(c.x, waveY + 0.45 + Math.sin(elapsed * 2.5 + i) * 0.12, c.z);
      _dummy.rotation.set(Math.sin(elapsed + i) * 0.2, elapsed * 1.1 + i, Math.cos(elapsed + i) * 0.2);
      const scale = c.tier === 'solar' ? 1.35 : c.tier === 'epic' ? 1.2 : c.tier === 'rare' ? 1.08 : 0.95;
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      this.cubeInstancedMesh.setMatrixAt(i, _dummy.matrix);
      _color.set(CUBE_CONFIG[c.tier].color);
      this.cubeInstancedMesh.setColorAt(i, _color);
    }
    this.cubeInstancedMesh.instanceMatrix.needsUpdate = true;
    if (this.cubeInstancedMesh.instanceColor) {
      this.cubeInstancedMesh.instanceColor.needsUpdate = true;
    }

    // Update burst particles
    let activePartCount = 0;
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        continue;
      }
      p.vy -= 12 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const s = 1 - p.life / p.maxLife;
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set(p.life * 6, p.life * 4, 0);
      _dummy.scale.setScalar(s);
      _dummy.updateMatrix();
      this.particleInstancedMesh.setMatrixAt(activePartCount, _dummy.matrix);
      _color.set(p.color);
      this.particleInstancedMesh.setColorAt(activePartCount, _color);
      activePartCount++;
    }
    this.particleInstancedMesh.count = activePartCount;
    this.particleInstancedMesh.instanceMatrix.needsUpdate = true;
    if (this.particleInstancedMesh.instanceColor) {
      this.particleInstancedMesh.instanceColor.needsUpdate = true;
    }

    // Update pulse ring effects
    for (let i = this.pulseEffects.length - 1; i >= 0; i--) {
      const fx = this.pulseEffects[i];
      fx.life += dt;
      const prog = fx.life / fx.maxLife;
      if (prog >= 1) {
        this.scene.remove(fx.mesh);
        fx.mesh.geometry.dispose();
        (fx.mesh.material as THREE.Material).dispose();
        this.pulseEffects.splice(i, 1);
      } else {
        fx.mesh.scale.setScalar(1 + prog * fx.maxRadius);
        (fx.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - prog) * 0.75;
      }
    }

    // Update throwable net / tool cast animations
    for (let i = this.castEffects.length - 1; i >= 0; i--) {
      const fx = this.castEffects[i];
      fx.elapsed += dt;
      const pRef = this.playerVisuals.get(fx.uid);
      const originX = pRef ? pRef.group.position.x : fx.fromX;
      const originY = pRef ? pRef.group.position.y + 1.15 : 1.5;
      const originZ = pRef ? pRef.group.position.z : fx.fromZ;
      const localWLand = this.getLocalWaveWeather(fx.toX, fx.toZ, wInt, state);
      const landY = getWaveHeight(fx.toX, fx.toZ, tSec, localWLand, islandR) + 0.3;

      if (fx.elapsed < fx.outboundDur) {
        const u = fx.elapsed / fx.outboundDur;
        const px = THREE.MathUtils.lerp(originX, fx.toX, u);
        const pz = THREE.MathUtils.lerp(originZ, fx.toZ, u);
        const arc = Math.sin(u * Math.PI) * 2.9;
        const py = THREE.MathUtils.lerp(originY, landY, u) + arc;
        fx.projectile.position.set(px, py, pz);
        fx.projectile.rotation.y += dt * 10;
      } else {
        if (!fx.landed) {
          fx.landed = true;
          this.spawnToolPulse(fx.toX, fx.toZ, fx.radius, fx.tool);
          this.spawnBurst(fx.toX, landY + 0.25, fx.toZ, '#bae6fd', 10);
          for (const cm of fx.caughtMeshes) {
            cm.mesh.visible = true;
          }
        }
        const retU = Math.min(1, (fx.elapsed - fx.outboundDur) / fx.returnDur);
        const px = THREE.MathUtils.lerp(fx.toX, originX, retU);
        const pz = THREE.MathUtils.lerp(fx.toZ, originZ, retU);
        const py = THREE.MathUtils.lerp(landY, originY, retU) + Math.sin(retU * Math.PI) * 0.7;
        fx.projectile.position.set(px, py, pz);
        for (const cm of fx.caughtMeshes) {
          cm.mesh.position.set(
            THREE.MathUtils.lerp(cm.startX, originX, retU),
            THREE.MathUtils.lerp(landY + 0.3, originY, retU) + Math.sin(retU * Math.PI) * 0.9,
            THREE.MathUtils.lerp(cm.startZ, originZ, retU)
          );
          cm.mesh.rotation.y += dt * 8;
        }
      }

      // Update rope tether vertices
      const posAttr = fx.tether.geometry.getAttribute('position') as THREE.BufferAttribute;
      posAttr.setXYZ(0, originX, originY, originZ);
      posAttr.setXYZ(1, fx.projectile.position.x, fx.projectile.position.y, fx.projectile.position.z);
      posAttr.needsUpdate = true;

      if (fx.elapsed >= fx.outboundDur + fx.returnDur) {
        this.scene.remove(fx.projectile);
        this.scene.remove(fx.tether);
        fx.tether.geometry.dispose();
        (fx.tether.material as THREE.Material).dispose();
        for (const cm of fx.caughtMeshes) {
          this.scene.remove(cm.mesh);
          cm.mesh.geometry.dispose();
          (cm.mesh.material as THREE.Material).dispose();
        }
        if (fx.caughtMeshes.length > 0) {
          this.spawnBurst(originX, originY + 0.4, originZ, '#fbbf24', 10);
        }
        this.castEffects.splice(i, 1);
      }
    }

    // Update harvester beams
    for (let i = this.beamEffects.length - 1; i >= 0; i--) {
      const b = this.beamEffects[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.line);
        b.line.geometry.dispose();
        (b.line.material as THREE.Material).dispose();
        this.beamEffects.splice(i, 1);
      } else {
        (b.line.material as THREE.LineBasicMaterial).opacity = b.life / 0.32;
      }
    }

    // Update aim reticle on water surface
    if (!this.isTitleMode && this.hasAim && localPlayer) {
      const pRef = this.playerVisuals.get(this.localUid);
      const px = pRef ? pRef.group.position.x : localPlayer.x;
      const pz = pRef ? pRef.group.position.z : localPlayer.z;
      const dx = this.aimPos.x - px;
      const dz = this.aimPos.z - pz;
      const dist = Math.hypot(dx, dz);
      const maxRange =
        localPlayer.activeTool === 'solar_lance'
          ? 38
          : localPlayer.activeTool === 'harpoon'
            ? 32
            : localPlayer.activeTool === 'magnet_net'
              ? 26
              : 17.5;
      const clampedDist = Math.min(maxRange, Math.max(3.5, dist));
      const dirX = dist > 0.01 ? dx / dist : Math.sin(localPlayer.angle);
      const dirZ = dist > 0.01 ? dz / dist : Math.cos(localPlayer.angle);
      const rx = px + dirX * clampedDist;
      const rz = pz + dirZ * clampedDist;
      const aimW = this.getLocalWaveWeather(rx, rz, wInt, state);
      const ry = getWaveHeight(rx, rz, tSec, aimW, islandR) + 0.25;
      this.aimReticle.position.set(rx, ry, rz);
      this.aimReticle.rotation.z = elapsed * 1.4;
      this.aimReticle.visible = true;
    } else {
      this.aimReticle.visible = false;
    }

    // Camera update (Title cinematic orbit vs Damped gameplay follow)
    if (this.isTitleMode || !localPlayer) {
      const a = elapsed * 0.22;
      _vec3A.set(Math.cos(a) * 32, 16, Math.sin(a) * 32);
      _vec3B.set(0, 2.2, 0);
      const damp = 1 - Math.exp(-3.5 * dt);
      this.cameraPos.lerp(_vec3A, damp);
      this.cameraLook.lerp(_vec3B, damp);
    } else {
      const pRef = this.playerVisuals.get(this.localUid);
      const px = pRef ? pRef.group.position.x : localPlayer.x;
      const py = pRef ? pRef.group.position.y : localPlayer.y;
      const pz = pRef ? pRef.group.position.z : localPlayer.z;

      const isPiloting = localPlayer.mode === 'piloting';
      const distBack = (isPiloting ? 20 : 14) * this.cameraZoom;
      const height = (isPiloting ? 14 : 10) * this.cameraZoom;

      _vec3A.set(
        px + Math.sin(this.cameraYaw) * distBack,
        py + height,
        pz + Math.cos(this.cameraYaw) * distBack
      );
      _vec3B.set(px, py + 1.2, pz);

      const damp = 1 - Math.exp(-8 * dt);
      this.cameraPos.lerp(_vec3A, damp);
      this.cameraLook.lerp(_vec3B, damp);

      // Keep shadow frustum centered near player/island following sun/moon arc
      this.keyLight.position.set(
        px + this.keyOffset.x,
        this.keyOffset.y,
        pz + this.keyOffset.z
      );
      this.keyLight.target.position.set(px, 0, pz);

      this.evaluatePrompts(localPlayer, state!);
    }

    this.camera.position.copy(this.cameraPos);
    if (this.cameraShake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.cameraShake;
      this.camera.position.y += (Math.random() - 0.5) * this.cameraShake;
      this.cameraShake *= Math.pow(0.02, dt);
    }
    this.camera.lookAt(this.cameraLook);
  }

  private evaluatePrompts(local: LivePlayerState, state: LiveWorldState) {
    if (!this.onPromptChange) return;
    const islandR = getIslandRadius(state.islandLevel);
    const dist = Math.hypot(local.x, local.z);
    const bedPos = getBedPosition(state.islandLevel);
    const nearBed = local.mode === 'walking' && Math.hypot(local.x - bedPos.x, local.z - bedPos.z) <= 3.6;
    const nearFabricator = dist <= 3.2 && !nearBed;
    const nearDepositZone =
      dist <= islandR + 10 + state.structures.dockLevel * 3.5 &&
      (local.carriedCubes.length > 0 ||
        (local.pilotingRaftId
          ? (state.rafts.find((r) => r.id === local.pilotingRaftId)?.cargo.length || 0) > 0
          : false));

    let nearRaftId: string | null = null;
    if (local.mode !== 'piloting') {
      for (const r of state.rafts) {
        if (!r.pilotUid && Math.hypot(r.x - local.x, r.z - local.z) < 6.5) {
          nearRaftId = r.id;
          break;
        }
      }
    }

    let inStorm = false;
    for (const st of state.storms) {
      if (Math.hypot(local.x - st.x, local.z - st.z) < st.radius) {
        inStorm = true;
        break;
      }
    }

    const roundedDist = Math.round(dist);
    const hash = `${nearRaftId}|${nearFabricator}|${nearBed}|${nearDepositZone}|${roundedDist}|${inStorm}`;
    if (hash !== this.lastPromptHash) {
      this.lastPromptHash = hash;
      this.onPromptChange({
        nearRaftId,
        nearFabricator,
        nearBed,
        nearDepositZone,
        distanceFromIsland: roundedDist,
        inStorm,
      });
    }
  }

  private lerpAngle(a: number, b: number, t: number): number {
    let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.renderer.domElement.removeEventListener('wheel', this.handleWheel);
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.removeEventListener('pointerleave', this.handlePointerLeave);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
