import * as THREE from 'three';
import {
  CUBE_CONFIG,
  getBedPosition,
  getIslandRadius,
  type CubeTier,
  type RaftState,
  type StructuresState,
  type ToolId,
} from '../shared/gameCatalog';

// Shared procedural canvas texture for subtle wood/sand grain (zero 404s)
export function createGrainTexture(baseHex: string, speckHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = speckHex;
  for (let i = 0; i < 320; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 43758.5453) % 1;
    const px = Math.abs(x) * 128;
    const py = Math.abs(y) * 128;
    ctx.fillRect(px, py, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(15, 23, 42, 0.55)');
  grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

export interface IslandVisualRefs {
  group: THREE.Group;
  fabricatorCrystal: THREE.Mesh;
  fabricatorRing: THREE.Mesh;
  bedLanternLight?: THREE.PointLight;
  bedLanternMat?: THREE.MeshStandardMaterial;
  refineryTurbine?: THREE.Group;
  lighthouseBeam?: THREE.Group;
  lighthouseBeamMat?: THREE.MeshBasicMaterial;
  drones: THREE.Group[];
  bayShieldRing?: THREE.Mesh;
}

export function buildIslandAndStructures(
  islandLevel: number,
  structures: StructuresState
): IslandVisualRefs {
  const group = new THREE.Group();
  const radius = getIslandRadius(islandLevel);

  const sandTex = createGrainTexture('#fde68a', '#f59e0b');
  const woodTex = createGrainTexture('#9a6338', '#6b3e1f');

  const sandMat = new THREE.MeshStandardMaterial({
    map: sandTex,
    roughness: 0.92,
    metalness: 0.0,
    flatShading: true,
  });
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x4ade80,
    roughness: 0.86,
    metalness: 0.0,
    flatShading: true,
  });
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.88,
    metalness: 0.05,
    flatShading: true,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    map: woodTex,
    roughness: 0.84,
    metalness: 0.02,
    flatShading: true,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.28,
    metalness: 0.85,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.25,
    metalness: 0.88,
  });

  // 1. Primary Island Sandy Base + Terraced Mound + Grass Crown
  const baseGeo = new THREE.CylinderGeometry(radius * 0.88, radius * 1.1, 2.2, 16);
  const baseMesh = new THREE.Mesh(baseGeo, sandMat);
  baseMesh.position.y = -0.35;
  baseMesh.receiveShadow = true;
  baseMesh.castShadow = true;
  group.add(baseMesh);

  const upperGeo = new THREE.CylinderGeometry(radius * 0.56, radius * 0.82, 1.3, 14);
  const upperMesh = new THREE.Mesh(upperGeo, sandMat);
  upperMesh.position.y = 0.9;
  upperMesh.receiveShadow = true;
  upperMesh.castShadow = true;
  group.add(upperMesh);

  const grassGeo = new THREE.CylinderGeometry(radius * 0.44, radius * 0.52, 0.45, 12);
  const grassMesh = new THREE.Mesh(grassGeo, grassMat);
  grassMesh.position.y = 1.6;
  grassMesh.receiveShadow = true;
  group.add(grassMesh);

  // Coastal rocks & palm trees scaling with islandLevel
  const palmCount = 3 + islandLevel * 2;
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x854d0e, roughness: 0.9, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.75, flatShading: true });

  for (let i = 0; i < palmCount; i++) {
    const a = (i / palmCount) * Math.PI * 2 + 0.4;
    const dist = radius * (0.48 + (i % 2) * 0.16);
    const palm = new THREE.Group();
    palm.position.set(Math.cos(a) * dist, 1.45, Math.sin(a) * dist);

    for (let seg = 0; seg < 4; seg++) {
      const segMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22 - seg * 0.03, 0.28 - seg * 0.03, 1.05, 6),
        trunkMat
      );
      segMesh.position.set(seg * 0.14, seg * 0.95 + 0.5, 0);
      segMesh.rotation.z = -0.11 * seg;
      segMesh.castShadow = true;
      palm.add(segMesh);
    }
    const crownPos = new THREE.Vector3(0.45, 4.1, 0);
    for (let f = 0; f < 5; f++) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.48, 2.2, 4), leafMat);
      const fa = (f / 5) * Math.PI * 2;
      frond.position.copy(crownPos);
      frond.rotation.order = 'YXZ';
      frond.rotation.y = fa;
      frond.rotation.x = 1.15;
      frond.translateY(0.9);
      frond.castShadow = true;
      palm.add(frond);
    }
    group.add(palm);
  }

  for (let i = 0; i < 6 + islandLevel; i++) {
    const a = (i / (6 + islandLevel)) * Math.PI * 2 + 0.2;
    const dist = radius * 0.85;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.75 + (i % 3) * 0.35, 0), rockMat);
    rock.position.set(Math.cos(a) * dist, 0.45, Math.sin(a) * dist);
    rock.rotation.set(i, i * 0.7, 0);
    rock.scale.y = 0.65;
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  // 2. Central Composite Fabricator Monument (6-10 parts)
  const fab = new THREE.Group();
  fab.position.set(0, 1.82, 0);
  const fabPlinth = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.7, 0.65, 8), rockMat);
  fabPlinth.position.y = 0.32;
  fabPlinth.castShadow = true;
  fabPlinth.receiveShadow = true;
  fab.add(fabPlinth);

  const fabCoreRing = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.16, 8, 24), brassMat);
  fabCoreRing.rotation.x = Math.PI / 2;
  fabCoreRing.position.y = 0.75;
  fab.add(fabCoreRing);

  const fabPillarCount = Math.min(6, 2 + islandLevel);
  for (let p = 0; p < fabPillarCount; p++) {
    const pa = (p / fabPillarCount) * Math.PI * 2;
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.2 + islandLevel * 0.22, 0.32), steelMat);
    pillar.position.set(Math.cos(pa) * 1.55, 1.5, Math.sin(pa) * 1.55);
    pillar.rotation.y = -pa;
    pillar.castShadow = true;
    fab.add(pillar);
  }

  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    emissive: 0x0891b2,
    emissiveIntensity: 0.9,
    roughness: 0.12,
    metalness: 0.25,
  });
  const fabricatorCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.75 + islandLevel * 0.06, 0), crystalMat);
  fabricatorCrystal.position.y = 2.65;
  fabricatorCrystal.castShadow = true;
  fab.add(fabricatorCrystal);

  const fabricatorRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.25, 0.08, 8, 28),
    new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xd97706,
      emissiveIntensity: 0.6,
      metalness: 0.9,
      roughness: 0.2,
    })
  );
  fabricatorRing.position.y = 2.65;
  fab.add(fabricatorRing);
  group.add(fab);

  // 2b. Island Camp Bed (Letto per dormire e rigenerare cubi al nuovo giorno)
  const bedPos = getBedPosition(islandLevel);
  const bed = new THREE.Group();
  bed.position.set(bedPos.x, 1.83, bedPos.z);
  bed.rotation.y = 0.65;

  const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 2.35), woodMat);
  bedFrame.position.y = 0.25;
  bedFrame.castShadow = true;
  bedFrame.receiveShadow = true;
  bed.add(bedFrame);

  for (const lx of [-0.62, 0.62]) {
    for (const lz of [-1.02, 1.02]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), woodMat);
      leg.position.set(lx, 0.12, lz);
      leg.castShadow = true;
      bed.add(leg);
    }
  }

  const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.68, 0.16), woodMat);
  headboard.position.set(0, 0.56, -1.08);
  headboard.castShadow = true;
  bed.add(headboard);

  const mattress = new THREE.Mesh(
    new THREE.BoxGeometry(1.36, 0.22, 2.1),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.85, flatShading: true })
  );
  mattress.position.set(0, 0.44, 0.04);
  mattress.castShadow = true;
  mattress.receiveShadow = true;
  bed.add(mattress);

  const blanket = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.24, 1.35),
    new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.78, flatShading: true })
  );
  blanket.position.set(0, 0.46, 0.4);
  blanket.castShadow = true;
  bed.add(blanket);

  const pillow = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 0.18, 0.44),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true })
  );
  pillow.position.set(0, 0.62, -0.72);
  pillow.castShadow = true;
  bed.add(pillow);

  // Small bedside camp lantern with warm night light
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.75, 6), woodMat);
  post.position.set(0.95, 0.36, -0.95);
  bed.add(post);
  const bedLanternMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.0,
  });
  const bedLantern = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), bedLanternMat);
  bedLantern.position.set(0.95, 0.78, -0.95);
  bed.add(bedLantern);

  const bedLanternLight = new THREE.PointLight(0xfbbf24, 0.35, 22, 2);
  bedLanternLight.position.set(0.95, 1.05, -0.95);
  bed.add(bedLanternLight);

  group.add(bed);

  // 3. Dock Structure (if dockLevel > 0)
  if (structures.dockLevel > 0) {
    const dock = new THREE.Group();
    const dockLen = 6 + structures.dockLevel * 2.2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.28, dockLen), woodMat);
    deck.position.set(0, 0.65, radius + dockLen * 0.42);
    deck.castShadow = true;
    deck.receiveShadow = true;
    dock.add(deck);

    for (let p = 0; p < 3 + structures.dockLevel; p++) {
      const zOff = radius + 1.5 + p * (dockLen / (3 + structures.dockLevel));
      for (const side of [-1.4, 1.4]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 2.2, 6), woodMat);
        post.position.set(side, 0.1, zOff);
        post.castShadow = true;
        dock.add(post);
      }
    }
    const lanternPost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.8, 6), steelMat);
    lanternPost.position.set(1.35, 1.55, radius + dockLen * 0.85);
    dock.add(lanternPost);
    const lanternBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xf59e0b, emissiveIntensity: 1.3 })
    );
    lanternBulb.position.set(1.35, 2.45, radius + dockLen * 0.85);
    dock.add(lanternBulb);
    group.add(dock);
  }

  // 4. Refinery Structure (if refineryLevel > 0)
  let refineryTurbine: THREE.Group | undefined;
  if (structures.refineryLevel > 0) {
    const ref = new THREE.Group();
    const a = -0.9;
    const dist = radius * 0.56;
    ref.position.set(Math.cos(a) * dist, 1.4, Math.sin(a) * dist);

    const pad = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 2.4), rockMat);
    pad.position.y = 0.2;
    pad.castShadow = true;
    ref.add(pad);

    for (const sx of [-0.75, 0.75]) {
      const vat = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 1.8 + structures.refineryLevel * 0.2, 10), brassMat);
      vat.position.set(sx, 1.2, 0);
      vat.castShadow = true;
      ref.add(vat);
    }

    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.7, 8), steelMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, 1.8, 0);
    ref.add(pipe);

    refineryTurbine = new THREE.Group();
    refineryTurbine.position.set(0, 2.4, 0.65);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 8), steelMat);
    hub.rotation.x = Math.PI / 2;
    refineryTurbine.add(hub);
    for (let b = 0; b < 4; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.06), brassMat);
      blade.rotation.z = (b * Math.PI) / 2;
      refineryTurbine.add(blade);
    }
    ref.add(refineryTurbine);
    group.add(ref);
  }

  // 5. Sea Platforms (if platformLevel > 0)
  if (structures.platformLevel > 0) {
    const platCount = 2 + structures.platformLevel * 2;
    for (let i = 0; i < platCount; i++) {
      const pa = (i / platCount) * Math.PI * 2 + 0.5;
      const pd = radius + 2.4;
      const plat = new THREE.Group();
      plat.position.set(Math.cos(pa) * pd, 0.35, Math.sin(pa) * pd);

      const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.28, 6), woodMat);
      deck.receiveShadow = true;
      deck.castShadow = true;
      plat.add(deck);

      const trim = new THREE.Mesh(new THREE.CylinderGeometry(2.32, 2.32, 0.14, 6), steelMat);
      trim.position.y = -0.1;
      plat.add(trim);
      group.add(plat);
    }
  }

  // 6. Lighthouse (if lighthouseLevel > 0)
  let lighthouseBeam: THREE.Group | undefined;
  let lighthouseBeamMat: THREE.MeshBasicMaterial | undefined;
  if (structures.lighthouseLevel > 0) {
    const lh = new THREE.Group();
    const la = 2.1;
    const ld = radius * 0.62;
    lh.position.set(Math.cos(la) * ld, 1.3, Math.sin(la) * ld);

    const lhBase = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 1.2, 8), rockMat);
    lhBase.position.y = 0.6;
    lhBase.castShadow = true;
    lh.add(lhBase);

    const towerH = 4.6 + structures.lighthouseLevel * 0.9;
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 1.05, towerH, 10),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5, flatShading: true })
    );
    tower.position.y = 1.2 + towerH * 0.5;
    tower.castShadow = true;
    lh.add(tower);

    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.84, 0.94, towerH * 0.28, 10),
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5, flatShading: true })
    );
    stripe.position.y = 1.2 + towerH * 0.55;
    lh.add(stripe);

    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.8, 0.35, 10), steelMat);
    gallery.position.y = 1.2 + towerH;
    lh.add(gallery);

    const lantern = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.85, 8),
      new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xfbbf24,
        emissiveIntensity: 1.6,
        transparent: true,
        opacity: 0.92,
      })
    );
    lantern.position.y = 1.7 + towerH;
    lh.add(lantern);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.8, 8), brassMat);
    cap.position.y = 2.45 + towerH;
    lh.add(cap);

    lighthouseBeam = new THREE.Group();
    lighthouseBeam.position.y = 1.7 + towerH;
    lighthouseBeamMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beamCone = new THREE.Mesh(
      new THREE.ConeGeometry(4.5, 28, 12, 1, true),
      lighthouseBeamMat
    );
    beamCone.rotation.x = Math.PI / 2;
    beamCone.position.z = 14;
    lighthouseBeam.add(beamCone);
    lh.add(lighthouseBeam);

    group.add(lh);
  }

  // 7. Auto-Collector Buoys & Hovering Drones (if autoCollectorLevel > 0)
  const drones: THREE.Group[] = [];
  if (structures.autoCollectorLevel > 0) {
    const count = 1 + structures.autoCollectorLevel;
    for (let i = 0; i < count; i++) {
      const da = (i / count) * Math.PI * 2;
      const dr = radius + 12;
      const drone = new THREE.Group();
      drone.position.set(Math.cos(da) * dr, 3.2, Math.sin(da) * dr);

      const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), steelMat);
      body.castShadow = true;
      drone.add(body);

      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x06b6d4, emissiveIntensity: 1.2 })
      );
      core.position.y = -0.35;
      drone.add(core);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.08, 6, 16), brassMat);
      ring.rotation.x = Math.PI / 2;
      drone.add(ring);

      group.add(drone);
      drones.push(drone);
    }
  }

  // 8. Bay Shield Anti-Shark Ring (if bayShieldLevel > 0)
  let bayShieldRing: THREE.Mesh | undefined;
  if (structures.bayShieldLevel > 0) {
    const shieldR = radius + 30 + structures.bayShieldLevel * 11;
    bayShieldRing = new THREE.Mesh(
      new THREE.RingGeometry(shieldR - 0.5, shieldR, 48),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    bayShieldRing.rotation.x = -Math.PI / 2;
    bayShieldRing.position.y = 0.22;
    group.add(bayShieldRing);
  }

  return {
    group,
    fabricatorCrystal,
    fabricatorRing,
    bedLanternLight,
    bedLanternMat,
    refineryTurbine,
    lighthouseBeam,
    lighthouseBeamMat,
    drones,
    bayShieldRing,
  };
}

export interface RaftVisualRefs {
  group: THREE.Group;
  cargoMeshes: THREE.Mesh[];
  propeller?: THREE.Group;
  capacity: number;
  level: number;
  engineLevel: number;
}

export function buildRaftGroup(raft: RaftState): RaftVisualRefs {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({
    color: raft.level >= 4 ? 0x7c2d12 : 0xa16207,
    roughness: 0.85,
    flatShading: true,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: raft.level >= 3 ? 0xe2e8f0 : 0x78350f,
    metalness: raft.level >= 3 ? 0.78 : 0.08,
    roughness: raft.level >= 3 ? 0.28 : 0.85,
  });
  const sailMat = new THREE.MeshStandardMaterial({
    color: raft.level >= 4 ? 0xfbbf24 : 0xfef3c7,
    roughness: 0.75,
    side: THREE.DoubleSide,
  });

  const width = 2.6 + (raft.level - 1) * 0.42;
  const length = 3.2 + (raft.level - 1) * 0.55;

  // Hull pontoons / logs
  const logCount = 3 + Math.min(3, raft.level);
  for (let i = 0; i < logCount; i++) {
    const xOff = ((i / (logCount - 1)) - 0.5) * (width - 0.35);
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, length, 8),
      woodMat
    );
    log.rotation.x = Math.PI / 2;
    log.position.set(xOff, 0.14, 0);
    log.castShadow = true;
    log.receiveShadow = true;
    group.add(log);
  }

  // Deck platform
  const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.18, length * 0.88), woodMat);
  deck.position.y = 0.35;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Side rails
  for (const sx of [-width * 0.48, width * 0.48]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, length * 0.84), trimMat);
    rail.position.set(sx, 0.5, 0);
    group.add(rail);
  }

  // Reinforced bow prow at Lv 3+
  if (raft.level >= 3) {
    const prow = new THREE.Mesh(new THREE.ConeGeometry(width * 0.48, 1.05, 4), trimMat);
    prow.rotation.x = Math.PI / 2;
    prow.rotation.y = Math.PI / 4;
    prow.position.set(0, 0.32, length * 0.52);
    prow.castShadow = true;
    group.add(prow);
  }

  // Sail Mast at Lv 2+
  if (raft.level >= 2) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.8, 6), woodMat);
    mast.position.set(0, 1.75, 0.45);
    mast.castShadow = true;
    group.add(mast);

    const sail = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.72, 1.55), sailMat);
    sail.position.set(0, 2.15, 0.55);
    sail.castShadow = true;
    group.add(sail);
  }

  // Outboard Turbo Engine at engineLevel > 0
  let propeller: THREE.Group | undefined;
  if (raft.engineLevel > 0) {
    const motor = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.65, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x0ea5e9, metalness: 0.75, roughness: 0.25 })
    );
    motor.position.set(0, 0.55, -length * 0.48);
    group.add(motor);

    propeller = new THREE.Group();
    propeller.position.set(0, 0.05, -length * 0.54);
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.04), trimMat);
      blade.rotation.z = (b * Math.PI * 2) / 3;
      propeller.add(blade);
    }
    group.add(propeller);
  }

  // Visible Cargo Slots on Deck (4 slots at Lv.1, scaling up to capacity!)
  const cargoMeshes: THREE.Mesh[] = [];
  const cols = raft.level <= 1 ? 2 : raft.level <= 3 ? 3 : 4;
  const rows = Math.ceil(raft.capacity / cols);
  const slotGeo = new THREE.BoxGeometry(0.36, 0.36, 0.36);

  for (let i = 0; i < raft.capacity; i++) {
    const layer = Math.floor(i / (cols * 3));
    const idxInLayer = i % (cols * 3);
    const col = idxInLayer % cols;
    const row = Math.floor(idxInLayer / cols);
    const slotX = ((col / Math.max(1, cols - 1)) - 0.5) * (width * 0.62);
    const slotZ = ((row / Math.max(1, Math.min(3, rows) - 1)) - 0.5) * (length * 0.52) - 0.15;
    const slotY = 0.64 + layer * 0.4;

    // Subtle slot frame marker for Lv 1-2 clarity
    if (layer === 0 && i < 8) {
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.04, 0.42),
        new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.9 })
      );
      marker.position.set(slotX, 0.46, slotZ);
      group.add(marker);
    }

    const cubeMesh = new THREE.Mesh(
      slotGeo,
      new THREE.MeshStandardMaterial({
        color: 0x22d3ee,
        emissive: 0x0891b2,
        emissiveIntensity: 0.45,
        roughness: 0.2,
        metalness: 0.15,
      })
    );
    cubeMesh.position.set(slotX, slotY, slotZ);
    cubeMesh.visible = false;
    cubeMesh.castShadow = true;
    group.add(cubeMesh);
    cargoMeshes.push(cubeMesh);
  }

  return {
    group,
    cargoMeshes,
    propeller,
    capacity: raft.capacity,
    level: raft.level,
    engineLevel: raft.engineLevel,
  };
}

export function syncRaftCargoVisuals(refs: RaftVisualRefs, cargo: CubeTier[]) {
  for (let i = 0; i < refs.cargoMeshes.length; i++) {
    const m = refs.cargoMeshes[i];
    if (i < cargo.length) {
      const cfg = CUBE_CONFIG[cargo[i]];
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.color.set(cfg.color);
      mat.emissive.set(cfg.emissive);
      m.visible = true;
    } else {
      m.visible = false;
    }
  }
}

export interface PlayerVisualRefs {
  group: THREE.Group;
  leftArm: THREE.Mesh;
  rightArm: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  toolMeshes: Record<ToolId, THREE.Group>;
  activeTool: ToolId;
}

export function buildPlayerGroup(colorHex: string, activeTool: ToolId): PlayerVisualRefs {
  const group = new THREE.Group();

  const suitMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.65, flatShading: true });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xfdba74, roughness: 0.78 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.6 });
  const packMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.75 });

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.42), suitMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  group.add(torso);

  // Backpack
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.65, 0.28), packMat);
  pack.position.set(0, 1.08, -0.32);
  pack.castShadow = true;
  group.add(pack);

  // Head + Visor
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.54, 0.54), skinMat);
  head.position.y = 1.78;
  head.castShadow = true;
  group.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.14), visorMat);
  visor.position.set(0, 1.82, 0.25);
  group.add(visor);

  // Limbs
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.68, 0.22), suitMat);
  leftArm.position.set(-0.5, 1.05, 0);
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.5, 1.25, 0);
  const rightArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.68, 0.22), suitMat);
  rightArmMesh.position.y = -0.22;
  rightArmMesh.castShadow = true;
  rightArm.add(rightArmMesh);

  // Craftable Held Tools attached to right hand
  const toolMeshes = createHeldTools();
  for (const [id, toolGroup] of Object.entries(toolMeshes) as [ToolId, THREE.Group][]) {
    toolGroup.position.set(0, -0.5, 0.35);
    toolGroup.visible = id === activeTool;
    rightArm.add(toolGroup);
  }
  group.add(rightArm);

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.62, 0.26), packMat);
  leftLeg.position.set(-0.2, 0.32, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.62, 0.26), packMat);
  rightLeg.position.set(0.2, 0.32, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  return { group, leftArm, rightArm, leftLeg, rightLeg, toolMeshes, activeTool };
}

function createHeldTools(): Record<ToolId, THREE.Group> {
  const wood = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.88, roughness: 0.2 });
  const cyan = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x06b6d4, emissiveIntensity: 0.8 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xd97706, emissiveIntensity: 0.9, metalness: 0.85 });

  // 1. Base Net
  const net = new THREE.Group();
  const netPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), wood);
  netPole.rotation.x = Math.PI / 2;
  net.add(netPole);
  const netHoop = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.03, 6, 12), steel);
  netHoop.rotation.x = Math.PI / 2;
  netHoop.position.z = 0.65;
  net.add(netHoop);

  // 2. Magnet Net
  const magnet_net = new THREE.Group();
  const magPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), steel);
  magPole.rotation.x = Math.PI / 2;
  magnet_net.add(magPole);
  const magRing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 14), cyan);
  magRing.rotation.x = Math.PI / 2;
  magRing.position.z = 0.65;
  magnet_net.add(magRing);

  // 3. Repulsor Harpoon
  const harpoon = new THREE.Group();
  const harpBody = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.9), steel);
  harpoon.add(harpBody);
  const harpTip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 4), cyan);
  harpTip.rotation.x = Math.PI / 2;
  harpTip.position.z = 0.65;
  harpoon.add(harpTip);

  // 4. Solar Lance
  const solar_lance = new THREE.Group();
  const lanceShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.4, 8), gold);
  lanceShaft.rotation.x = Math.PI / 2;
  solar_lance.add(lanceShaft);
  const lanceHead = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), gold);
  lanceHead.position.z = 0.82;
  solar_lance.add(lanceHead);

  return { net, magnet_net, harpoon, solar_lance };
}

export interface SharkVisualRefs {
  group: THREE.Group;
  tail: THREE.Group;
}

export function buildSharkGroup(): SharkVisualRefs {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.45, flatShading: true });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6, flatShading: true });

  const body = new THREE.Mesh(new THREE.ConeGeometry(0.62, 2.8, 6), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.4;
  body.castShadow = true;
  group.add(body);

  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.35, 1.8), bellyMat);
  belly.position.set(0, -0.22, 0.1);
  group.add(belly);

  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.15, 4), bodyMat);
  dorsal.position.set(0, 0.68, 0.15);
  dorsal.rotation.x = -0.35;
  dorsal.castShadow = true;
  group.add(dorsal);

  for (const sx of [-0.65, 0.65]) {
    const pec = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.85, 4), bodyMat);
    pec.position.set(sx, -0.1, 0.25);
    pec.rotation.z = sx > 0 ? -1.2 : 1.2;
    group.add(pec);
  }

  const tail = new THREE.Group();
  tail.position.z = -1.0;
  const tailFin = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.0, 4), bodyMat);
  tailFin.rotation.x = -Math.PI / 2;
  tailFin.position.z = -0.45;
  tail.add(tailFin);
  group.add(tail);

  return { group, tail };
}

export function buildStormGroup(radius: number): THREE.Group {
  const group = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.95,
    flatShading: true,
  });

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(radius * 0.34, 0), cloudMat);
    puff.position.set(Math.cos(a) * radius * 0.42, 17 + (i % 2) * 2.2, Math.sin(a) * radius * 0.42);
    puff.scale.y = 0.55;
    group.add(puff);
  }
  const centerCloud = new THREE.Mesh(new THREE.DodecahedronGeometry(radius * 0.45, 0), cloudMat);
  centerCloud.position.y = 19;
  centerCloud.scale.y = 0.52;
  group.add(centerCloud);

  const rainCurtain = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.85, radius * 0.95, 17, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  rainCurtain.position.y = 8.5;
  group.add(rainCurtain);

  return group;
}
