import { schema, t } from '@colyseus/schema';
import type { SchemaType } from '@colyseus/schema';
import { protocolVersion } from '@crossy/protocol';

export const TransportMemberState = schema({
  slot: t.string().default('p1'),
  connectionGeneration: t.number().default(0),
  connected: t.boolean().default(true),
  acceptedInputs: t.number().default(0),
  lastSequence: t.number().default(0),
  x: t.number().default(0),
  z: t.number().default(0),
}, 'TransportMember');
export type TransportMemberState = SchemaType<typeof TransportMemberState>;

export const TransportState = schema({
  protocolVersion: t.number().default(protocolVersion),
  revision: t.number().default(0),
  runGeneration: t.number().default(0),
  phase: t.string().default('waiting'),
  players: t.map(TransportMemberState),
}, 'TransportState');
export type TransportState = SchemaType<typeof TransportState>;
