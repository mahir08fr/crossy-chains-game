import { expect,it } from 'vitest';
import { defaultDisplayName,normalizeDisplayName,isNameCommand,protocolVersion } from './index';
it('normalizes NFC and whitespace with 16 graphemes rather than UTF-16 slicing',()=>{
 expect(normalizeDisplayName('  Jose\u0301   Lee  ')).toBe('José Lee');
 expect(normalizeDisplayName('🦄'.repeat(16))).toBe('🦄'.repeat(16));expect(normalizeDisplayName('🦄'.repeat(17))).toBeUndefined();
 expect(normalizeDisplayName('')).toBe('');expect(defaultDisplayName('p4')).toBe('Player 4');
});
it('rejects markup, controls, bidi formatting, broken surrogates, excessive input and non-text',()=>{
 for(const v of ['<script>alert(1)</script>','a\nb','a\u202Eb','a\u0000b','\uD800','\uFE0F','\u0301','x'.repeat(257),null,{}])expect(normalizeDisplayName(v)).toBeUndefined();
 expect(normalizeDisplayName('A & B')).toBe('A & B');
});
it('requires exact name command shape, freshness generations/revision and never accepts a target slot',()=>{
 const c={protocolVersion,connectionGeneration:1,runGeneration:0,lobbyEpoch:1,revision:1,name:'Alex'};
 expect(isNameCommand(c)).toBe(true);expect(isNameCommand({...c,slot:'p2'})).toBe(false);expect(isNameCommand({...c,revision:-1})).toBe(false);
});

it('validates synchronized display text as strictly as command text while retaining legacy default-name fixtures',async()=>{
 const {isLobbyMessage}=await import('./index');
 const message={protocolVersion,capacity:2,code:'ABCDEFGH',epoch:1,revision:1,runGeneration:0,stage:'lobby',host:'p1',players:[{slot:'p1',connected:true,ready:false,restartRequested:false,displayName:'Alex'}]};
 expect(isLobbyMessage(message)).toBe(true);
 for(const displayName of ['<b>',' a ','','x'.repeat(17),'a\u202Eb'])expect(isLobbyMessage({...message,players:[{...message.players[0],displayName}]})).toBe(false);
 const {displayName,...legacy}=message.players[0]!;expect(displayName).toBe('Alex');expect(isLobbyMessage({...message,players:[legacy]})).toBe(true);
});
