import { expect,it } from 'vitest';
import { PrivateLobby } from './private-lobby.js';
it('keeps names room-scoped and slot-stable across disconnect, ownership transfer and secure reclaim',()=>{
 const lobby=new PrivateLobby('ABCDEFGH',0,4);for(const s of ['p1','p2','p3','p4'] as const)lobby.join(s,0);
 let state=lobby.state(0);expect(lobby.rename('p3',state.epoch,state.revision,' Alex ',1)).toBeUndefined();
 lobby.connection('p1',false,2);lobby.connection('p3',false,2);lobby.connection('p3',true,3);
 expect(lobby.state(0).players.find(p=>p.slot==='p3')!.displayName).toBe('Alex');expect(lobby.state(0).host).toBe('p2');
 lobby.leave('p3',4);lobby.join('p3',5);expect(lobby.state(0).players.find(p=>p.slot==='p3')!.displayName).toBe('Player 3');
 const fresh=new PrivateLobby('BCDEFGHJ',0);fresh.join('p1',0);expect(fresh.state(0).players[0]!.displayName).toBe('Player 1');
});
it('rejects stale rename, ready/playing changes and unsafe text; supports empty defaults and duplicate names',()=>{
 const lobby=new PrivateLobby('ABCDEFGH',0);lobby.join('p1',0);lobby.join('p2',0);let s=lobby.state(0);
 expect(lobby.rename('p1',s.epoch,s.revision,'Alex',1)).toBeUndefined();expect(lobby.rename('p1',s.epoch,s.revision,'Old',2)).toBe('stale-command');
 s=lobby.state(0);expect(lobby.rename('p2',s.epoch,s.revision,'Alex',2)).toBeUndefined();s=lobby.state(0);
 expect(lobby.rename('p1',s.epoch,s.revision,'<b>',3)).toBe('invalid-command');
 expect(lobby.rename('p1',s.epoch,s.revision,'\uFE0F',3)).toBe('invalid-command');
 expect(lobby.rename('p1',s.epoch,s.revision,' ',3)).toBeUndefined();s=lobby.state(0);expect(s.players[0]!.displayName).toBe('Player 1');
 lobby.command('p1',s.epoch,'ready',false,4);s=lobby.state(0);expect(lobby.rename('p1',s.epoch,s.revision,'Late',5)).toBe('not-in-lobby');
 lobby.command('p2',s.epoch,'ready',false,5);lobby.command('p1',s.epoch,'start',false,6);s=lobby.state(1);expect(lobby.rename('p2',s.epoch,s.revision,'Late',7)).toBe('not-in-lobby');
});
