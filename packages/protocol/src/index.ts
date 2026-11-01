import { normalizeDisplayName } from './display-name.js';
export { normalizeDisplayName, defaultDisplayName } from './display-name.js';
import { riverRulesVersion, riverLayout, sectionStart, sectionLength } from '@crossy/config';
import { wrapTrafficX, generatedVehicleSlots, railwaySettings, difficultyAt, difficultyVersion, generatorVersion, roadLanes, validateSection } from '@crossy/config';
import type { WorldSection } from '@crossy/config';
// Transport contracts only: no physics, renderer or networking-library imports.
export const protocolVersion = 1 as const;
export const transportRoomName = 'transport-test';
export const maxMessageBytes = 4096;
// Server-to-client assembly payloads have a separate bound; input/HTTP limits stay 4 KiB.
export const maxSnapshotBytes = 16384;
// Expanded generated state contains up to 24 sections × 25 pooled slots. Compact
// packets retain the original 16-KiB bound; client input limits are independent.
export const maxGeneratedSnapshotBytes = 65536;
export const chainCourses = ['slack', 'taut', 'post', 'barrier', 'two-posts'] as const;
// M2 fixture list stays available for its unchanged regression gate.
export type ChainCourse = typeof chainCourses[number] | 'road' | 'river' | 'railway' | 'generated';
export type RoomOptions = JoinOptions & { chainCourse?: ChainCourse };
export type Rotation4 = Point3 & { w: number };
export type SegmentPose = { position: Point3; rotation: Rotation4 };
export type MotionChain = { course: ChainCourse; endpoints: PlayerSlot[]; segments: SegmentPose[] };
export const playerSlots = ['p1', 'p2', 'p3', 'p4'] as const;
export type PlayerSlot = typeof playerSlots[number];
export type GroupSize = 2 | 3 | 4;
export type PrivateRoomOptions = JoinOptions & { capacity?: GroupSize; seed?: number; course?: 'road' | 'river' | 'railway' | 'generated' };
export function isGroupSize(value: unknown): value is GroupSize { return value === 2 || value === 3 || value === 4; }
export function isPrivateRoomOptions(value: unknown): value is PrivateRoomOptions {
  if (!isRecord(value)) return false;
  const keys = ['protocolVersion', ...(Object.hasOwn(value, 'capacity') ? ['capacity'] : []), ...(Object.hasOwn(value, 'seed') ? ['seed'] : []), ...(Object.hasOwn(value, 'course') ? ['course'] : [])];
  return shape(value, keys) && value.protocolVersion === protocolVersion
    && (!Object.hasOwn(value, 'capacity') || isGroupSize(value.capacity))
    && (!Object.hasOwn(value, 'seed') || value.course === 'generated' && integer(value.seed) && value.seed <= 0xffffffff)
    && (!Object.hasOwn(value, 'course') || value.course === 'road' || value.course === 'river' || value.course === 'railway' || value.course === 'generated');
}
export type JoinOptions = { protocolVersion: typeof protocolVersion };
export type ProbeMessage = JoinOptions & { sequence: number; clientTimeMs: number };
export type ProbeReply = ProbeMessage & { serverTimeMs: number; slot: PlayerSlot };
export type InputMessage = JoinOptions & {
  sequence: number;
  connectionGeneration: number;
  runGeneration: number;
  // A recent server-issued monotonic timestamp; never a client wall clock.
  referenceTimeMs: number;
  x: number;
  z: number;
};
export type WelcomeMessage = JoinOptions & {
  slot: PlayerSlot;
  connectionGeneration: number;
  runGeneration: number;
  serverTimeMs: number;
};
export type InputExpiredMessage = WelcomeMessage & { sequence: number; silenceMs: number };
export type Point3 = { x: number; y: number; z: number };
export type MotionPlayer = {
  id: PlayerSlot;
  position: Point3;
  velocity: Point3;
  grounded: boolean;
  acknowledgedSequence: number;
};
export type RoomPhase = 'waiting' | 'running' | 'paused' | 'fault' | 'ended';
export type SnapshotMessage = JoinOptions & {
  phase: RoomPhase;
  droppedSeconds: number;
  scenarioVersion: number;
  runGeneration: number;
  tick: number;
  serverTimeMs: number;
  players: MotionPlayer[];
  chain?: MotionChain;
  world?: MotionWorld;
  run?: EndlessRun;
  road?: MotionRoad;
  railway?: MotionRailway;
  river?: MotionRiver;
};
export type EndlessRun = { distance: number; roomBest: number; previousBest: number; newRecord: boolean; difficultyTier: number; difficultyVersion: typeof difficultyVersion };
export type MotionWorld = { highWater: number; rearLimit: number; version: typeof generatorVersion; riverVersion: typeof riverRulesVersion; seed: number; elapsedSeconds: number; sections: WorldSection[];
  hazards: { id: string; road?: MotionRoad; railway?: MotionRailway }[];
  water: MotionRiver; dead: PlayerSlot[]; outcome: 'active' | 'failed' };
export type MotionWaterPlayer = { id: PlayerSlot; phase: 'safe' | 'entering' | 'endangered' | 'recovering' | 'failed'; exposureSeconds: number; safeSeconds: number };
export type MotionRiver = { exposureLimitSeconds: number; recoverySeconds: number; players: MotionWaterPlayer[]; dead: PlayerSlot[]; outcome: 'active' | 'failed' | 'cleared' };
export type MotionRailway = { elapsedSeconds: number; pass: number; x: number; signal: 'safe' | 'warning' | 'occupying'; dead: PlayerSlot[]; outcome: 'active' | 'failed' | 'cleared' };
export type MotionRoad = {
  elapsedSeconds: number;
  vehicles: { id: number; lane: number; x: number }[];
  dead: PlayerSlot[];
  outcome: 'active' | 'failed' | 'cleared';
};
export type RejectionCode = 'invalid-message' | 'invalid-generation' | 'old-sequence' | 'rate-limit' | 'stale-input' | 'requires-neutral';
export type RejectionMessage = { code: RejectionCode };

const encoder = new TextEncoder();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const integer = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);
const slot = (value: unknown): value is PlayerSlot => (playerSlots as readonly unknown[]).includes(value);
function shape(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function bounded(value: unknown, limit = maxMessageBytes): boolean {
  try {
    const json = JSON.stringify(value);
    return json !== undefined && encoder.encode(json).byteLength <= limit;
  } catch { return false; }
}
function point(value: unknown): value is Point3 {
  return shape(value, ['x', 'y', 'z']) && finite(value.x) && finite(value.y) && finite(value.z);
}

export function isJoinOptions(value: unknown): value is JoinOptions {
  return shape(value, ['protocolVersion']) && value.protocolVersion === protocolVersion;
}
export function isChainCourse(value: unknown): value is ChainCourse {
  return value === 'road' || value === 'river' || value === 'railway' || value === 'generated' || (typeof value === 'string' && (chainCourses as readonly string[]).includes(value));
}
export function isRoomOptions(value: unknown): value is RoomOptions {
  return isJoinOptions(value) || (shape(value, ['protocolVersion', 'chainCourse'])
    && value.protocolVersion === protocolVersion && isChainCourse(value.chainCourse));
}
function isMotionChain(value: unknown, count: number): value is MotionChain {
  if (!shape(value, ['course', 'endpoints', 'segments']) || !isChainCourse(value.course)
    || !Array.isArray(value.endpoints) || value.endpoints.length !== count
    || !value.endpoints.every((id, index) => id === playerSlots[index])
    || !Array.isArray(value.segments) || value.segments.length !== 12 * (count - 1)) return false;
  return value.segments.every((segment) => {
    if (!shape(segment, ['position', 'rotation']) || !point(segment.position)
      || !shape(segment.rotation, ['x', 'y', 'z', 'w'])) return false;
    const q = segment.rotation;
    return finite(q.x) && finite(q.y) && finite(q.z) && finite(q.w)
      && Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 0.001;
  });
}
export function isProbeMessage(value: unknown): value is ProbeMessage {
  return shape(value, ['protocolVersion', 'sequence', 'clientTimeMs']) && bounded(value)
    && value.protocolVersion === protocolVersion && integer(value.sequence) && nonnegative(value.clientTimeMs);
}
export function isProbeReply(value: unknown): value is ProbeReply {
  return shape(value, ['protocolVersion', 'sequence', 'clientTimeMs', 'serverTimeMs', 'slot']) && bounded(value)
    && value.protocolVersion === protocolVersion && integer(value.sequence) && nonnegative(value.clientTimeMs)
    && nonnegative(value.serverTimeMs) && slot(value.slot);
}
export function isInputMessage(value: unknown): value is InputMessage {
  return shape(value, ['protocolVersion', 'sequence', 'connectionGeneration', 'runGeneration', 'referenceTimeMs', 'x', 'z'])
    && bounded(value) && value.protocolVersion === protocolVersion && integer(value.sequence)
    && integer(value.connectionGeneration) && integer(value.runGeneration) && nonnegative(value.referenceTimeMs)
    && finite(value.x) && finite(value.z) && Math.abs(value.x) <= 1 && Math.abs(value.z) <= 1;
}
export function isWelcomeMessage(value: unknown): value is WelcomeMessage {
  return shape(value, ['protocolVersion', 'slot', 'connectionGeneration', 'runGeneration', 'serverTimeMs']) && bounded(value)
    && value.protocolVersion === protocolVersion && slot(value.slot) && integer(value.connectionGeneration)
    && integer(value.runGeneration) && nonnegative(value.serverTimeMs);
}
export function isInputExpiredMessage(value: unknown): value is InputExpiredMessage {
  return shape(value, ['protocolVersion', 'slot', 'connectionGeneration', 'runGeneration', 'serverTimeMs', 'sequence', 'silenceMs'])
    && bounded(value) && value.protocolVersion === protocolVersion && slot(value.slot)
    && integer(value.connectionGeneration) && integer(value.runGeneration) && nonnegative(value.serverTimeMs)
    && integer(value.sequence) && nonnegative(value.silenceMs);
}
function isMotionRoad(value: unknown, phase: RoomPhase): value is MotionRoad {
  if (!shape(value, ['elapsedSeconds', 'vehicles', 'dead', 'outcome']) || !nonnegative(value.elapsedSeconds)
    || !Array.isArray(value.vehicles) || value.vehicles.length !== 6
    || !Array.isArray(value.dead) || value.dead.length > 4 || !value.dead.every(slot)
    || new Set(value.dead).size !== value.dead.length) return false;
  if (value.outcome === 'active' ? value.dead.length !== 0 || phase === 'ended'
    : value.outcome === 'failed' ? value.dead.length === 0 || phase !== 'ended'
    : value.outcome !== 'cleared' || value.dead.length !== 0 || phase !== 'ended') return false;
  return value.vehicles.every((vehicle, index) => shape(vehicle, ['id', 'lane', 'x'])
    && vehicle.id === index && vehicle.lane === Math.floor(index / 2)
    && finite(vehicle.x) && vehicle.x >= -18 && vehicle.x < 18);
}
function isMotionRailway(value: unknown, phase: RoomPhase, count = 4): value is MotionRailway {
  if (!shape(value, ['elapsedSeconds', 'pass', 'x', 'signal', 'dead', 'outcome'])
    || !nonnegative(value.elapsedSeconds) || !integer(value.pass) || !finite(value.x) || Math.abs(value.x) > 48.001
    || !['safe', 'warning', 'occupying'].includes(value.signal as string)
    || !Array.isArray(value.dead) || value.dead.some(id => !playerSlots.slice(0, count).includes(id))
    || new Set(value.dead).size !== value.dead.length) return false;
  return value.outcome === 'active' ? value.dead.length === 0 && phase !== 'ended'
    : value.outcome === 'failed' ? value.dead.length > 0 && phase === 'ended'
    : value.outcome === 'cleared' && value.dead.length === 0 && phase === 'ended';
}
export function isSnapshotMessage(value: unknown): value is SnapshotMessage {
  const keys = ['protocolVersion', 'scenarioVersion', 'runGeneration', 'tick', 'serverTimeMs', 'players', 'phase', 'droppedSeconds'];
  const generated = isRecord(value) && Object.hasOwn(value, 'world');
  if (generated) keys.push('world', 'run');
  const chained = isRecord(value) && Object.hasOwn(value, 'chain');
  const railway = isRecord(value) && Object.hasOwn(value, 'railway');
  if (railway) keys.push('railway');
  const river = isRecord(value) && Object.hasOwn(value, 'river');
  if (river) keys.push('river');
  const road = isRecord(value) && Object.hasOwn(value, 'road');
  if (road) keys.push('road');
  if (!shape(value, chained ? [...keys, 'chain'] : keys)
    || !bounded(value, generated ? maxGeneratedSnapshotBytes : maxSnapshotBytes) || value.protocolVersion !== protocolVersion || (typeof value.phase !== 'string' || !['waiting', 'running', 'paused', 'fault', 'ended'].includes(value.phase))
    || !nonnegative(value.droppedSeconds) || !integer(value.scenarioVersion)
    || !integer(value.runGeneration) || !integer(value.tick) || !nonnegative(value.serverTimeMs)
    || !Array.isArray(value.players) || value.players.length < 2 || value.players.length > 4) return false;
  const count = value.players.length;
  if (chained && !isMotionChain(value.chain, count)) return false;
  if (railway && (road || river || !chained || value.scenarioVersion !== 6 || (value.chain as MotionChain).course !== 'railway' || !isMotionRailway(value.railway, value.phase as RoomPhase, count))) return false;
  if (!railway && chained && (value.chain as MotionChain).course === 'railway') return false;
  if (river && (road || !chained || value.scenarioVersion !== 5 || (value.chain as MotionChain).course !== 'river' || !isMotionRiver(value.river, value.phase as RoomPhase, count))) return false;
  if (!river && chained && (value.chain as MotionChain).course === 'river') return false;
  if (generated && (!isEndlessRun(value.run, value.phase as RoomPhase) || road || river || railway || !chained || (value.chain as MotionChain).course !== 'generated' || !isMotionWorld(value.world, value.phase as RoomPhase, count))) return false;
  if (!generated && chained && (value.chain as MotionChain).course === 'generated') return false;
  if (chained ? value.scenarioVersion !== (generated ? 7 : railway ? 6 : river ? 5 : count > 2 ? 4 : road ? 3 : 2) || !isMotionChain(value.chain, count) : value.scenarioVersion !== 1 || count !== 2) return false;
  if (road ? !chained || (value.chain as MotionChain).course !== 'road' || !isMotionRoad(value.road, value.phase as RoomPhase)
    : (chained && (value.chain as MotionChain).course === 'road') || (!generated && !river && !railway && value.phase === 'ended')) return false;
  if (road && (value.road as MotionRoad).dead.some(id => !playerSlots.slice(0, count).includes(id))) return false;
  const ids = new Set<PlayerSlot>();
  for (const [index, player] of value.players.entries()) {
    if (player?.id !== playerSlots[index]) return false;
    if (!shape(player, ['id', 'position', 'velocity', 'grounded', 'acknowledgedSequence'])
      || !slot(player.id) || ids.has(player.id) || !point(player.position) || !point(player.velocity)
      || typeof player.grounded !== 'boolean' || !integer(player.acknowledgedSequence)) return false;
    ids.add(player.id);
  }
  return true;
}
export function isRejectionMessage(value: unknown): value is RejectionMessage {
  return shape(value, ['code']) && typeof value.code === 'string' && ['invalid-message', 'invalid-generation', 'old-sequence', 'rate-limit', 'stale-input', 'requires-neutral'].includes(value.code);
}

// Metadata used by the Task 3 harness, not physical player state.
export type TransportMember = {
  connected: boolean;
  slot: PlayerSlot;
  connectionGeneration: number;
  acceptedInputs: number;
  lastSequence: number;
  x: number;
  z: number;
};
export type TransportMetadata = {
  protocolVersion: number;
  revision: number;
  runGeneration: number;
  phase: RoomPhase;
  players: ReadonlyMap<string, TransportMember>;
};

// M7 keeps invitation lookup separate from the SDK's private reclaim credential.
export const privateRoomName = 'private-game';
export type LobbyAction = 'ready' | 'unready' | 'start' | 'restart' | 'cancel-restart';
export type LobbyCommand = JoinOptions & { connectionGeneration: number; runGeneration: number; lobbyEpoch: number; action: LobbyAction };
export type LobbyMember = { slot: PlayerSlot; connected: boolean; ready: boolean; restartRequested: boolean; displayName?: string };
export type LobbyMessage = JoinOptions & {
  capacity: GroupSize; code: string; epoch: number; revision: number; runGeneration: number;
  stage: 'lobby' | 'playing'; host: PlayerSlot | null; players: LobbyMember[];
};
export const lobbyRejectionReasons = ['not-host', 'not-ready', 'not-in-lobby', 'not-playing', 'need-two-players', 'stale-command', 'invalid-command', 'command-rate'] as const;
export type LobbyRejectionReason = typeof lobbyRejectionReasons[number];
export type LobbyRejection = JoinOptions & { reason: LobbyRejectionReason };
export type RoomClosedMessage = JoinOptions & { reason: 'idle-timeout' | 'display-left' };
export function isPrivateCode(value: unknown): value is string { return typeof value === 'string' && /^[A-HJ-NP-Z2-9]{8}$/.test(value); }
export function isLobbyCommand(value: unknown): value is LobbyCommand {
  return shape(value, ['protocolVersion', 'connectionGeneration', 'runGeneration', 'lobbyEpoch', 'action']) && bounded(value)
    && value.protocolVersion === protocolVersion && integer(value.connectionGeneration) && integer(value.runGeneration)
    && integer(value.lobbyEpoch) && typeof value.action === 'string' && ['ready', 'unready', 'start', 'restart', 'cancel-restart'].includes(value.action);
}
export function isLobbyMessage(value: unknown): value is LobbyMessage {
  if (!shape(value, ['protocolVersion', 'capacity', 'code', 'epoch', 'revision', 'runGeneration', 'stage', 'host', 'players']) || !bounded(value)
    || value.protocolVersion !== protocolVersion || !isPrivateCode(value.code) || !integer(value.epoch) || !integer(value.revision)
    || !integer(value.runGeneration) || !['lobby', 'playing'].includes(value.stage as string)
    || !isGroupSize(value.capacity) || !Array.isArray(value.players) || value.players.length > value.capacity) return false;
  const slots = new Set<PlayerSlot>(), connected = new Set<PlayerSlot>();
  for (const player of value.players) {
    if (!shape(player, ['slot', 'connected', 'ready', 'restartRequested', ...(isRecord(player) && Object.hasOwn(player, 'displayName') ? ['displayName'] : [])]) || !slot(player.slot) || !playerSlots.slice(0, value.capacity as GroupSize).includes(player.slot) || slots.has(player.slot)
      || (Object.hasOwn(player, 'displayName') && (normalizeDisplayName(player.displayName) !== player.displayName || player.displayName === ''))
      || typeof player.connected !== 'boolean' || typeof player.ready !== 'boolean' || typeof player.restartRequested !== 'boolean'
      || (!player.connected && (player.ready || player.restartRequested)) || (value.stage === 'lobby' && player.restartRequested)
      || (value.stage === 'playing' && player.ready)) return false;
    slots.add(player.slot); if (player.connected) connected.add(player.slot);
  }
  return connected.size === 0 ? value.host === null : slot(value.host) && connected.has(value.host);
}
export function isLobbyRejection(value: unknown): value is LobbyRejection {
  return shape(value, ['protocolVersion', 'reason']) && value.protocolVersion === protocolVersion
    && (lobbyRejectionReasons as readonly unknown[]).includes(value.reason);
}
export function isRoomClosedMessage(value: unknown): value is RoomClosedMessage {
  return shape(value, ['protocolVersion', 'reason']) && value.protocolVersion === protocolVersion && (value.reason === 'idle-timeout' || value.reason === 'display-left');
}

/** Lossless opt-in wire format: omit repeated pose keys, never quantize physics. */
export type CompactWorld = Omit<MotionWorld, 'sections' | 'hazards' | 'water'> & { sections: number[]; hazards: number[][]; water: number[] };
export type CompactSnapshot = Omit<SnapshotMessage, 'chain' | 'world'> & {
  world?: CompactWorld;
  chain: Omit<MotionChain, 'segments'> & { segments: number[] };
};
export function isSnapshotHello(value: unknown): value is JoinOptions & { snapshotFormat?: 'flat-chain-v1' } {
  return isJoinOptions(value) || (shape(value, ['protocolVersion', 'snapshotFormat'])
    && value.protocolVersion === protocolVersion && value.snapshotFormat === 'flat-chain-v1');
}
const waterPhases = ['safe','entering','endangered','recovering','failed'] as const;
const encodeDead = (ids:PlayerSlot[]):number => ids.reduce((bits,id)=>bits | 1 << playerSlots.indexOf(id),0);
const decodeDead = (bits:number):PlayerSlot[] => playerSlots.filter((_,i)=>!!(bits & 1 << i));
/** Numeric tuples omit repeated keys/constants, preserving every authoritative number. */
function packWorld(world:MotionWorld):CompactWorld {
  return {...world,
    sections:world.sections.flatMap(s=>[s.index,['grass','road','river','railway'].indexOf(s.type),s.speed,s.direction,s.offset,s.safeSeconds,s.difficultyTier]),
    hazards:world.hazards.map(h=>{
      const index=world.sections.find(s=>s.id===h.id)!.index;
      return h.road?[index,0,h.road.elapsedSeconds,...h.road.vehicles.filter((v,i,all)=>i===0||v.lane!==all[i-1]!.lane).map(v=>v.x),encodeDead(h.road.dead)]
        :[index,1,h.railway!.elapsedSeconds,h.railway!.pass,h.railway!.x,['safe','warning','occupying'].indexOf(h.railway!.signal),encodeDead(h.railway!.dead)];
    }),
    water:[world.water.exposureLimitSeconds,world.water.recoverySeconds,...world.water.players.flatMap(p=>[waterPhases.indexOf(p.phase),p.exposureSeconds,p.safeSeconds])],
  };
}
export function packSnapshot(snapshot: SnapshotMessage): CompactSnapshot {
  if (!snapshot.chain) throw new Error('Compact snapshot requires a chain');
  const {world,...base}=snapshot;
  return { ...base, ...(world?{world:packWorld(world)}:{}), chain: { ...snapshot.chain,
    segments: snapshot.chain.segments.flatMap(({ position: p, rotation: q }) => [p.x, p.y, p.z, q.x, q.y, q.z, q.w]) } };
}
export function unpackSnapshot(value: unknown): SnapshotMessage | undefined {
  if (!isRecord(value) || !bounded(value,maxSnapshotBytes) || !isRecord(value.chain) || !Array.isArray(value.players)
    || value.players.length < 2 || value.players.length > 4 || !Array.isArray(value.chain.segments)) return;
  const numbers: unknown[] = value.chain.segments;
  if (numbers.length !== 12 * (value.players.length - 1) * 7 || !numbers.every(finite)) return;
  const segments: SegmentPose[] = [];
  for (let i = 0; i < numbers.length; i += 7) {
    const n = numbers as number[];
    segments.push({ position: { x: n[i]!, y: n[i + 1]!, z: n[i + 2]! },
      rotation: { x: n[i + 3]!, y: n[i + 4]!, z: n[i + 5]!, w: n[i + 6]! } });
  }
  let world: MotionWorld | undefined;
  if(Object.hasOwn(value,'world')){
    if(!isRecord(value.world)||!Array.isArray(value.world.sections)||value.world.sections.length===0||value.world.sections.length>168||value.world.sections.length%7!==0||!value.world.sections.every(finite))return;
    const sections:WorldSection[]=[];
    const n=value.world.sections as number[];
    for(let i=0;i<n.length;i+=7){
      const index=n[i]!,code=n[i+1]!;if(!Number.isSafeInteger(index)||!Number.isInteger(code)||code<0||code>3)return;
      const section:WorldSection={id:`v4:${value.world.seed}:${index}`,index,type:(['grass','road','river','railway'] as const)[code]!,start:sectionStart(index),length:sectionLength(index),halfWidth:10,speed:n[i+2]!,direction:n[i+3]!,offset:n[i+4]!,safeSeconds:n[i+5]!,difficultyTier:n[i+6]!};
      // Validate before deterministic slot reconstruction uses descriptor parameters.
      if(validateSection(section,value.players.length as 2|3|4).length)return;
      if(section.type==='river')section.river=riverLayout(section);
      sections.push(section);
    }
    const raw=value.world;
    if(!Array.isArray(raw.hazards)||raw.hazards.length>24||!Array.isArray(raw.water)||raw.water.length!==2+value.players.length*3||!raw.water.every(finite))return;
    const hazards:MotionWorld['hazards']=[];
    for(const row of raw.hazards){
      if(!Array.isArray(row)||(row.length<6||row.length>9)||!row.every(finite)||!Number.isSafeInteger(row[0]))return;
      const mask=row.at(-1);if(!integer(mask)||mask>15)return;
      const id=`v4:${raw.seed}:${row[0]}`,dead=decodeDead(mask),outcome=dead.length?'failed' as const:'active' as const;
      if(row[1]===0&&row.length>=6&&row.length<=9){
        const section=sections.find(s=>s.id===id);if(!section||section.type!=='road')return;
        const lanes=roadLanes(section);if(row.length!==lanes.length+4)return;
        hazards.push({id,road:{elapsedSeconds:row[2] as number,vehicles:generatedVehicleSlots(section).map(({id,lane,slot})=>({id,lane,x:slot===0?row[3+lane] as number:wrapTrafficX((row[3+lane] as number)+lanes[lane]!.positions[slot]!,lanes[lane]!.period)})),dead,outcome}});
      }
      else if(row[1]===1&&row.length===7&&integer(row[5])&&row[5]<=2)hazards.push({id,railway:{elapsedSeconds:row[2] as number,pass:row[3] as number,x:row[4] as number,signal:(['safe','warning','occupying'] as const)[row[5] as number]!,dead,outcome}});
      else return;
    }
    const waterNumbers=raw.water as number[],players:MotionWaterPlayer[]=[];
    for(let i=0;i<value.players.length;i++){
      const at=2+i*3,code=waterNumbers[at]!;if(!Number.isInteger(code)||code<0||code>4)return;
      players.push({id:playerSlots[i]!,phase:waterPhases[code]!,exposureSeconds:waterNumbers[at+1]!,safeSeconds:waterNumbers[at+2]!});
    }
    const dead=players.filter(p=>p.phase==='failed').map(p=>p.id);
    world={...raw,sections,hazards,water:{exposureLimitSeconds:waterNumbers[0]!,recoverySeconds:waterNumbers[1]!,players,dead,outcome:dead.length?'failed':'active'}} as MotionWorld;
  }
  const snapshot = { ...value, ...(world?{world}:{}), chain: { ...value.chain, segments } };
  return isSnapshotMessage(snapshot) ? snapshot : undefined;
}

// M9 roles are immutable at admission; public codes never carry reclaim credentials.
export const couchRoomName = 'couch-game';
export type CouchRole = 'display' | 'controller';
export type CouchOptions = JoinOptions & ({ role: 'controller' } | { role: 'display'; displaySecret: string; capacity?: GroupSize; seed?: number; course?: 'road' | 'river' | 'railway' | 'generated' });
export type DisplayWelcome = JoinOptions & { role: 'display'; connectionGeneration: number; runGeneration: number; serverTimeMs: number };
export type ControllerStatus = JoinOptions & { runGeneration: number; serverTimeMs: number; phase: RoomPhase; outcome: 'active' | 'failed' | 'cleared'; displayActive: boolean; endless?: true; railway?: MotionRailway; river?: MotionRiver };
export function isCouchOptions(value: unknown): value is CouchOptions {
  if (!isRecord(value) || value.protocolVersion !== protocolVersion) return false;
  if (value.role === 'controller') return shape(value, ['protocolVersion', 'role']);
  return value.role === 'display'
    && shape(value, ['protocolVersion', 'role', 'displaySecret', ...(Object.hasOwn(value, 'capacity') ? ['capacity'] : []), ...(Object.hasOwn(value, 'seed') ? ['seed'] : []), ...(Object.hasOwn(value, 'course') ? ['course'] : [])])
    && typeof value.displaySecret === 'string' && /^[a-f0-9]{32}$/.test(value.displaySecret)
    && (!Object.hasOwn(value, 'capacity') || isGroupSize(value.capacity))
    && (!Object.hasOwn(value, 'seed') || value.course === 'generated' && integer(value.seed) && value.seed <= 0xffffffff)
    && (!Object.hasOwn(value, 'course') || value.course === 'road' || value.course === 'river' || value.course === 'railway' || value.course === 'generated');
}
export function isDisplayWelcome(value: unknown): value is DisplayWelcome {
  return shape(value, ['protocolVersion', 'role', 'connectionGeneration', 'runGeneration', 'serverTimeMs'])
    && value.protocolVersion === protocolVersion && value.role === 'display' && integer(value.connectionGeneration)
    && integer(value.runGeneration) && nonnegative(value.serverTimeMs);
}
export function isControllerStatus(value: unknown): value is ControllerStatus {
  return shape(value, ['protocolVersion', 'runGeneration', 'serverTimeMs', 'phase', 'outcome', 'displayActive', ...(isRecord(value) && Object.hasOwn(value, 'endless') ? ['endless'] : []), ...(isRecord(value) && Object.hasOwn(value, 'river') ? ['river'] : []), ...(isRecord(value) && Object.hasOwn(value, 'railway') ? ['railway'] : [])])
    && value.protocolVersion === protocolVersion && integer(value.runGeneration) && nonnegative(value.serverTimeMs)
    && ['waiting', 'running', 'paused', 'fault', 'ended'].includes(value.phase as string)
    && ['active', 'failed', 'cleared'].includes(value.outcome as string) && typeof value.displayActive === 'boolean'
    && (value.phase === 'ended' ? value.outcome !== 'active' : value.outcome === 'active')
    && (!Object.hasOwn(value, 'endless') || value.endless === true && !Object.hasOwn(value, 'river') && !Object.hasOwn(value, 'railway'))
    && (!Object.hasOwn(value, 'railway') || !Object.hasOwn(value, 'river') && isMotionRailway(value.railway, value.phase as RoomPhase) && value.railway.outcome === value.outcome)
    && (!Object.hasOwn(value, 'river') || isRecord(value.river) && Array.isArray(value.river.players) && value.river.players.length >= 2 && value.river.players.length <= 4 && isMotionRiver(value.river, value.phase as RoomPhase, value.river.players.length) && value.river.outcome === value.outcome);
}
export function isDisplayHeartbeat(value: unknown): value is JoinOptions & { active: boolean } {
  return shape(value, ['protocolVersion', 'active']) && value.protocolVersion === protocolVersion && typeof value.active === 'boolean';
}

export const couchPauseReasons = ['lobby', 'missing-player', 'controller-disconnected', 'input-expired', 'requires-neutral', 'display-disconnected', 'display-inactive', 'display-heartbeat-stale'] as const;
export type CouchPauseReason = typeof couchPauseReasons[number];
export type CouchBlocker = { device: PlayerSlot | 'display' | 'room'; reason: CouchPauseReason };
export const controllerDiagnosticEvents = ['input-gate', 'sender-stall', 'clock-sample-rejected', 'clock-sample-accepted', 'blur', 'focus', 'visibility', 'resize', 'orientation', 'pagehide', 'pageshow', 'welcome', 'input-expired', 'input-rejected', 'connection'] as const;
export type ControllerDiagnosticEvent = typeof controllerDiagnosticEvents[number];
export type ControllerDiagnosticDetail = Record<string, number | boolean | string>;
export type ControllerDiagnostic = JoinOptions & { connectionGeneration: number; event: ControllerDiagnosticEvent; detail: ControllerDiagnosticDetail };
export type CouchHealth = JoinOptions & {
  serverTimeMs: number; runGeneration: number; phase: RoomPhase; boundary: string;
  blockers: CouchBlocker[];
  display: { connected: boolean; active: boolean; heartbeatAgeMs: number | null };
  streams: { slot: PlayerSlot; generation: number; sequence: number; requiresNeutral: boolean; neutralReason: 'connected' | 'cleared' | 'expired' | null; silenceMs: number | null; lastRejection: RejectionCode | null }[];
  reports: { slot: PlayerSlot; serverTimeMs: number; event: ControllerDiagnosticEvent; detail: ControllerDiagnosticDetail }[];
};
const diagnosticKeys = ['reason','rttMs','bestRttMs','offsetMs','arrivalAgeMs','alignedAgeMs','gapMs','hidden','focused','connected','visible','code','phase'];
function isDiagnosticDetail(value: unknown): value is ControllerDiagnosticDetail {
  return isRecord(value) && Object.keys(value).length <= 8 && Object.entries(value).every(([key, v]) => diagnosticKeys.includes(key)
    && (finite(v) || typeof v === 'boolean' || typeof v === 'string' && v.length <= 64));
}
export function isControllerDiagnostic(value: unknown): value is ControllerDiagnostic {
  return shape(value, ['protocolVersion','connectionGeneration','event','detail']) && bounded(value, 1024) && value.protocolVersion === protocolVersion
    && integer(value.connectionGeneration) && (controllerDiagnosticEvents as readonly unknown[]).includes(value.event) && isDiagnosticDetail(value.detail);
}
export function isCouchHealth(value: unknown): value is CouchHealth {
  if (!shape(value, ['protocolVersion','serverTimeMs','runGeneration','phase','boundary','blockers','display','streams','reports']) || !bounded(value, 8192)
    || value.protocolVersion !== protocolVersion || !nonnegative(value.serverTimeMs) || !integer(value.runGeneration)
    || !['waiting','running','paused','fault','ended'].includes(value.phase as string) || typeof value.boundary !== 'string' || value.boundary.length > 80
    || !Array.isArray(value.blockers) || value.blockers.length > 6 || !Array.isArray(value.streams) || value.streams.length > 4
    || !Array.isArray(value.reports) || value.reports.length > 8 || !shape(value.display, ['connected','active','heartbeatAgeMs'])
    || typeof value.display.connected !== 'boolean' || typeof value.display.active !== 'boolean'
    || !(value.display.heartbeatAgeMs === null || nonnegative(value.display.heartbeatAgeMs))) return false;
  return value.blockers.every(b => shape(b, ['device','reason']) && (slot(b.device) || b.device === 'room' || b.device === 'display') && (couchPauseReasons as readonly unknown[]).includes(b.reason))
    && value.streams.every(s => shape(s, ['slot','generation','sequence','requiresNeutral','neutralReason','silenceMs','lastRejection']) && slot(s.slot) && integer(s.generation) && integer(s.sequence)
      && typeof s.requiresNeutral === 'boolean' && [null,'connected','cleared','expired'].includes(s.neutralReason as null | string)
      && (s.silenceMs === null || nonnegative(s.silenceMs)) && (s.lastRejection === null || isRejectionMessage({ code: s.lastRejection })))
    && value.reports.every(r => shape(r, ['slot','serverTimeMs','event','detail']) && slot(r.slot) && nonnegative(r.serverTimeMs)
      && (controllerDiagnosticEvents as readonly unknown[]).includes(r.event) && isDiagnosticDetail(r.detail));
}


export function isMotionRiver(value: unknown, phase: RoomPhase, count: number): value is MotionRiver {
  if (!shape(value, ['exposureLimitSeconds', 'recoverySeconds', 'players', 'dead', 'outcome'])
    || !finite(value.exposureLimitSeconds) || value.exposureLimitSeconds <= 0 || value.exposureLimitSeconds > 60
    || !finite(value.recoverySeconds) || value.recoverySeconds <= 0 || value.recoverySeconds > 10 || !Array.isArray(value.players) || value.players.length !== count
    || !Array.isArray(value.dead) || value.dead.length > count || !value.dead.every(slot) || new Set(value.dead).size !== value.dead.length) return false;
  for (const [i, p] of value.players.entries()) {
    if (!shape(p, ['id','phase','exposureSeconds','safeSeconds']) || p.id !== playerSlots[i]
      || !['safe','entering','endangered','recovering','failed'].includes(p.phase as string)
      || !nonnegative(p.exposureSeconds) || p.exposureSeconds > value.exposureLimitSeconds || !nonnegative(p.safeSeconds) || p.safeSeconds > value.recoverySeconds
      || (p.phase === 'safe' ? p.exposureSeconds !== 0 || p.safeSeconds !== 0 : p.exposureSeconds === 0)
      || (p.phase !== 'recovering' && p.safeSeconds !== 0)
      || (p.phase === 'failed' ? p.exposureSeconds !== value.exposureLimitSeconds : p.exposureSeconds >= value.exposureLimitSeconds)) return false;
  }
  const dead = value.players.filter(p => p.phase === 'failed').map(p => p.id);
  if (JSON.stringify(dead) !== JSON.stringify(value.dead)) return false;
  return value.outcome === 'active' ? dead.length === 0 && phase !== 'ended'
    : value.outcome === 'failed' ? dead.length > 0 && phase === 'ended'
    : value.outcome === 'cleared' && dead.length === 0 && phase === 'ended' && value.players.every(p => p.phase === 'safe');
}

/** Explicit generated schema bounds: no client physics or random generation. */
export function isMotionWorld(v: unknown, phase: RoomPhase, count: number): v is MotionWorld {
  if (!shape(v,['highWater','rearLimit','version','riverVersion','seed','elapsedSeconds','sections','hazards','water','dead','outcome']) || v.version !== generatorVersion || v.riverVersion !== riverRulesVersion || !nonnegative(v.highWater) || !finite(v.rearLimit) || v.rearLimit < -6.7 || v.rearLimit > Math.max(-6.7,(v.highWater as number)-7)
    || !integer(v.seed) || v.seed > 0xffffffff || !nonnegative(v.elapsedSeconds)
    || !Array.isArray(v.sections) || v.sections.length < 1 || v.sections.length > 24
    || !Array.isArray(v.hazards) || v.hazards.length > 24 || !Array.isArray(v.dead)
    || new Set(v.dead).size !== v.dead.length || !v.dead.every(id=>playerSlots.slice(0,count).includes(id))
    || !['active','failed'].includes(v.outcome as string)
    || (v.outcome === 'failed' ? phase !== 'ended' || v.dead.length === 0 : phase === 'ended' || v.dead.length !== 0)) return false;
  const sections = new Map<string, WorldSection>();
  for (const [i,s] of v.sections.entries()) {
    if (!shape(s,['id','index','type','start','length','halfWidth','speed','direction','offset','safeSeconds','difficultyTier',...(isRecord(s)&&s.type==='river'?['river']:[])])
      || !Number.isSafeInteger(s.index) || !finite(s.start) || s.start !== sectionStart(s.index as number) || s.length !== sectionLength(s.index as number) || s.halfWidth !== 10
      || s.id !== `v4:${v.seed}:${s.index}` || !['grass','road','river','railway'].includes(s.type as string)
      || !finite(s.speed) || s.speed < 0 || s.speed > railwaySettings.speed || ![-1,1].includes(s.direction as number)
      || !finite(s.offset) || Math.abs(s.offset)>18 || !finite(s.safeSeconds) || (s.type==='railway'?s.safeSeconds!==railwaySettings.safeSeconds:s.safeSeconds<20||s.safeSeconds>22)
      || validateSection(s as WorldSection,count as 2|3|4).length>0
      || i>0 && s.index !== v.sections[i-1].index+1) return false;
    if(s.type==='river'){
      const expected=riverLayout(s as WorldSection),recipe=s.river;
      if(!shape(recipe,['version','direction','strength','acceleration','rocks','fallback'])
        || recipe.version!==expected.version || recipe.direction!==expected.direction || recipe.strength!==expected.strength
        || recipe.acceleration!==expected.acceleration || recipe.fallback!==expected.fallback
        || !Array.isArray(recipe.rocks) || recipe.rocks.length!==expected.rocks.length
        || !recipe.rocks.every((r,i)=>shape(r,['id','size','x','z']) && r.id===expected.rocks[i]!.id && r.size===expected.rocks[i]!.size && r.x===expected.rocks[i]!.x && r.z===expected.rocks[i]!.z))return false;
    }
    sections.set(s.id as string,s as WorldSection);
  }
  const seen = new Set<string>();
  for(const h of v.hazards){
    if(!isRecord(h) || typeof h.id!=='string' || seen.has(h.id))return false;
    seen.add(h.id); const s=sections.get(h.id); if(!s)return false;
    if(s.type==='railway') { if(!shape(h,['id','railway']) || !isMotionRailway(h.railway, (h.railway as MotionRailway)?.outcome==='failed'?'ended':'running',count) || (h.railway as MotionRailway).outcome==='cleared')return false; }
    else if(s.type==='road') {
      const lanes=roadLanes(s), slots=generatedVehicleSlots(s);
      if(!shape(h,['id','road']) || !shape(h.road,['elapsedSeconds','vehicles','dead','outcome']) || !nonnegative(h.road.elapsedSeconds)
        || !Array.isArray(h.road.vehicles) || h.road.vehicles.length!==slots.length
        || !h.road.vehicles.every((v,i,vehicles)=>{
          const slot=slots[i]!,l=lanes[slot.lane]!;
          return shape(v,['id','lane','x']) && v.id===slot.id && v.lane===slot.lane && finite(v.x) && Math.abs(v.x)<=l.period/2+1e-8
            && (slot.slot===0 || v.x===wrapTrafficX(vehicles[i-slot.slot].x+l.positions[slot.slot]!,l.period));
        })
        || !Array.isArray(h.road.dead) || !h.road.dead.every(id=>playerSlots.slice(0,count).includes(id))
        || !['active','failed'].includes(h.road.outcome as string) || (h.road.outcome==='failed')!==(h.road.dead.length>0))return false;
    }else return false;
  }
  if([...sections.values()].filter(s=>s.type==='road'||s.type==='railway').length!==seen.size)return false;
  if(!isMotionRiver(v.water,(v.water as MotionRiver)?.outcome==='failed'?'ended':'running',count) || (v.water as MotionRiver).outcome==='cleared')return false;
  const dead=[...new Set([...v.hazards.flatMap(h=>h.road?.dead??h.railway?.dead??[]),...(v.water as MotionRiver).dead])].sort();
  return JSON.stringify(dead)===JSON.stringify(v.dead);
}

function isEndlessRun(v: unknown, phase: RoomPhase): v is EndlessRun {
  return shape(v, ['distance','roomBest','previousBest','newRecord','difficultyTier','difficultyVersion'])
    && nonnegative(v.distance) && nonnegative(v.roomBest) && nonnegative(v.previousBest)
    && v.roomBest >= v.previousBest && v.difficultyVersion === difficultyVersion
    && v.difficultyTier === difficultyAt(v.distance)
    && v.newRecord === (phase === 'ended' && v.distance > v.previousBest)
    && (phase !== 'ended' || v.roomBest >= v.distance);
}

export type NameCommand = JoinOptions & { connectionGeneration: number; runGeneration: number; lobbyEpoch: number; revision: number; name: string };
export function isNameCommand(value: unknown): value is NameCommand {
  return shape(value, ['protocolVersion','connectionGeneration','runGeneration','lobbyEpoch','revision','name']) && bounded(value)
    && value.protocolVersion === protocolVersion && integer(value.connectionGeneration) && integer(value.runGeneration)
    && integer(value.lobbyEpoch) && integer(value.revision) && normalizeDisplayName(value.name) !== undefined;
}
