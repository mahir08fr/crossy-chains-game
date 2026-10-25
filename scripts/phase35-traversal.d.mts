import type {SnapshotMessage,PlayerSlot} from '@crossy/protocol';
import type {TraversalGate} from './phase2-traversal.mjs';
export type {TraversalGate};
export function traversalInput(snapshot: SnapshotMessage,gate?:TraversalGate): {gate:TraversalGate|undefined;byPlayer:Partial<Record<PlayerSlot,number>>;byPlayerX:Partial<Record<PlayerSlot,number>>};
