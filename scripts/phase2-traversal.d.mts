import type {SnapshotMessage} from '@crossy/protocol';
export type TraversalGate={id:string;stopAfter:number};
export function traversalInput(snapshot:SnapshotMessage,gate?:TraversalGate):{gate:TraversalGate|undefined;byPlayer:Record<string,number>};
