import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  createDefaultRoomSnapshot,
  createInitialPlayerProgress,
  type RoomSnapshot,
} from './shared/gameCatalog';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Controlla la configurazione Firebase: il client è offline.');
    }
  }
}

testConnection();

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

function sanitizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 16);
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `ISOLA-${suffix}`;
}

function sanitizeRaftsForCloud(rafts: RoomSnapshot['rafts']) {
  return rafts.slice(0, 3).map((r) => ({
    id: String(r.id).slice(0, 32),
    name: String(r.name).slice(0, 40),
    level: Math.max(1, Math.min(5, Math.floor(r.level))),
    capacity: Math.max(4, Math.min(40, Math.floor(r.capacity))),
    engineLevel: Math.max(0, Math.min(4, Math.floor(r.engineLevel))),
    hullLevel: Math.max(1, Math.min(5, Math.floor(r.hullLevel))),
    hp: Math.max(0, Math.min(500, Math.round(r.hp))),
    maxHp: Math.max(50, Math.min(500, Math.round(r.maxHp))),
    x: Number.isFinite(r.x) ? Number(r.x.toFixed(2)) : 16,
    z: Number.isFinite(r.z) ? Number(r.z.toFixed(2)) : 0,
    angle: Number.isFinite(r.angle) ? Number(r.angle.toFixed(3)) : 0,
    cargo: Array.isArray(r.cargo) ? r.cargo.slice(0, 40) : [],
  }));
}

function sanitizeStructuresForCloud(s: RoomSnapshot['structures']) {
  return {
    refineryLevel: Math.max(0, Math.min(5, Math.floor(s.refineryLevel))),
    dockLevel: Math.max(0, Math.min(4, Math.floor(s.dockLevel))),
    lighthouseLevel: Math.max(0, Math.min(4, Math.floor(s.lighthouseLevel))),
    autoCollectorLevel: Math.max(0, Math.min(5, Math.floor(s.autoCollectorLevel))),
    platformLevel: Math.max(0, Math.min(4, Math.floor(s.platformLevel))),
    bayShieldLevel: Math.max(0, Math.min(4, Math.floor(s.bayShieldLevel))),
  };
}

function sanitizePlayerProgressForCloud(progressMap: RoomSnapshot['playerProgress']) {
  const result: Record<string, unknown> = {};
  const entries = Object.entries(progressMap).slice(0, 12);
  for (const [uid, p] of entries) {
    result[uid] = {
      uid: String(p.uid).slice(0, 128),
      displayName: String(p.displayName || 'Naufrago').slice(0, 48),
      color: String(p.color || '#f59e0b').slice(0, 20),
      xp: Math.max(0, Math.floor(p.xp)),
      level: Math.max(1, Math.min(20, Math.floor(p.level))),
      activeTool: p.activeTool,
      tools: { ...p.tools },
      gear: { ...p.gear },
      repairKits: Math.max(0, Math.min(99, Math.floor(p.repairKits))),
      potions: Math.max(0, Math.min(99, Math.floor(p.potions || 0))),
      food: Math.max(0, Math.min(99, Math.floor(p.food || 0))),
    };
  }
  return result;
}

export async function upsertUserProfile(user: User, addRoomCode?: string): Promise<string[]> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    let recentRooms: string[] = [];
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data.recentRooms)) {
        recentRooms = data.recentRooms.filter((c): c is string => typeof c === 'string');
      }
    }
    if (addRoomCode) {
      const clean = sanitizeRoomCode(addRoomCode);
      if (clean.length >= 4) {
        recentRooms = [clean, ...recentRooms.filter((c) => c !== clean)].slice(0, 10);
      }
    }
    const payload: Record<string, unknown> = {
      uid: user.uid,
      displayName: (user.displayName || 'Esploratore').slice(0, 64),
      recentRooms,
      updatedAt: serverTimestamp(),
    };
    if (user.photoURL) {
      payload.photoURL = user.photoURL.slice(0, 512);
    }
    await setDoc(ref, payload);
    return recentRooms;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function createIslandRoom(user: User, islandName: string): Promise<RoomSnapshot> {
  const roomCode = generateRoomCode();
  const cleanName = (islandName.trim() || 'Isola del Sole').slice(0, 48);
  const displayName = (user.displayName || 'Esploratore').slice(0, 48);
  const initial = createDefaultRoomSnapshot(roomCode, cleanName, user.uid, displayName);
  const path = `rooms/${roomCode}`;

  try {
    await setDoc(doc(db, 'rooms', roomCode), {
      roomCode: initial.roomCode,
      name: initial.name,
      hostUid: initial.hostUid,
      memberUids: initial.memberUids,
      bankCubes: initial.bankCubes,
      islandLevel: initial.islandLevel,
      structures: sanitizeStructuresForCloud(initial.structures),
      rafts: sanitizeRaftsForCloud(initial.rafts),
      playerProgress: sanitizePlayerProgressForCloud(initial.playerProgress),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await upsertUserProfile(user, roomCode);
    return initial;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function joinIslandRoomByCode(user: User, rawCode: string): Promise<RoomSnapshot> {
  const roomCode = sanitizeRoomCode(rawCode);
  if (roomCode.length < 4) {
    throw new Error('Inserisci un codice stanza valido (almeno 4 caratteri).');
  }
  const path = `rooms/${roomCode}`;
  const ref = doc(db, 'rooms', roomCode);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      throw new Error(`Nessuna isola trovata con il codice ${roomCode}.`);
    }
    const data = snap.data();
    const memberUids: string[] = Array.isArray(data.memberUids) ? data.memberUids : [];
    const playerProgress = { ...(data.playerProgress || {}) };
    const displayName = (user.displayName || 'Esploratore').slice(0, 48);

    if (!memberUids.includes(user.uid)) {
      if (memberUids.length >= 12) {
        throw new Error('Questa stanza ha raggiunto il limite massimo di 12 giocatori.');
      }
      const nextMembers = [...memberUids, user.uid];
      if (!playerProgress[user.uid]) {
        playerProgress[user.uid] = createInitialPlayerProgress(
          user.uid,
          displayName,
          nextMembers.length - 1
        );
      }
      await updateDoc(ref, {
        memberUids: nextMembers,
        playerProgress: sanitizePlayerProgressForCloud(playerProgress),
        updatedAt: serverTimestamp(),
      });
      await upsertUserProfile(user, roomCode);
      return hydrateSnapshotFromDoc(roomCode, {
        ...data,
        memberUids: nextMembers,
        playerProgress,
      });
    }

    await upsertUserProfile(user, roomCode);
    return hydrateSnapshotFromDoc(roomCode, data);
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('Nessuna') || error.message.startsWith('Questa') || error.message.startsWith('Inserisci'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function fetchUserRooms(uid: string): Promise<RoomSnapshot[]> {
  const path = 'rooms';
  try {
    const q = query(collection(db, 'rooms'), where('memberUids', 'array-contains', uid));
    const snaps = await getDocs(q);
    return snaps.docs.map((d) => hydrateSnapshotFromDoc(d.id, d.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveRoomSnapshotToCloud(snapshot: RoomSnapshot): Promise<void> {
  if (!auth.currentUser) return;
  const path = `rooms/${snapshot.roomCode}`;
  try {
    await updateDoc(doc(db, 'rooms', snapshot.roomCode), {
      bankCubes: Math.max(0, Math.min(10000000, Math.round(snapshot.bankCubes))),
      islandLevel: Math.max(1, Math.min(6, Math.floor(snapshot.islandLevel))),
      structures: sanitizeStructuresForCloud(snapshot.structures),
      rafts: sanitizeRaftsForCloud(snapshot.rafts),
      playerProgress: sanitizePlayerProgressForCloud(snapshot.playerProgress),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

function hydrateSnapshotFromDoc(roomCode: string, data: Record<string, any>): RoomSnapshot {
  const fallback = createDefaultRoomSnapshot(
    roomCode,
    String(data.name || 'Isola Condivisa'),
    String(data.hostUid || ''),
    'Host'
  );
  return {
    roomCode,
    name: String(data.name || fallback.name),
    hostUid: String(data.hostUid || ''),
    memberUids: Array.isArray(data.memberUids) ? data.memberUids : [],
    bankCubes: Number(data.bankCubes || 0),
    islandLevel: Math.max(1, Math.min(6, Number(data.islandLevel || 1))),
    structures: {
      ...fallback.structures,
      ...(data.structures || {}),
    },
    rafts: Array.isArray(data.rafts)
      ? data.rafts.slice(0, 3).map((r: any, idx: number) => ({
          id: String(r.id || `raft-${idx + 1}`),
          name: String(r.name || (idx === 0 ? 'Zattera Pioneera' : `Zattera ${idx + 1}`)),
          level: Math.max(1, Math.min(5, Number(r.level || 1))),
          capacity: Math.max(4, Math.min(40, Number(r.capacity || 4))),
          engineLevel: Math.max(0, Math.min(4, Number(r.engineLevel || 0))),
          hullLevel: Math.max(1, Math.min(5, Number(r.hullLevel || 1))),
          hp: Number(r.hp ?? 100),
          maxHp: Number(r.maxHp ?? 100),
          x: Number(r.x ?? 16),
          z: Number(r.z ?? 0),
          angle: Number(r.angle ?? 0),
          vx: 0,
          vz: 0,
          pilotUid: null,
          cargo: Array.isArray(r.cargo) ? r.cargo : [],
        }))
      : [],
    playerProgress: Object.fromEntries(
      Object.entries(data.playerProgress || {}).map(([uid, prog]: [string, any]) => [
        uid,
        {
          ...createInitialPlayerProgress(uid, prog?.displayName || 'Esploratore', 0),
          ...(prog || {}),
          potions: Number(prog?.potions || 0),
          food: Number(prog?.food || 0),
        },
      ])
    ),
  };
}
