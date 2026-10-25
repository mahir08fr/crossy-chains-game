import { afterEach, expect,it,vi } from 'vitest';
import { OrthographicCamera } from 'three';
import { PlayerLabels } from './player-labels';
import { PlayerView } from './player-view';
import { NameInput } from './name-input';
import { NamedFeedback } from './named-feedback';
import type { LobbyMessage } from '@crossy/protocol';
class Node extends EventTarget {
 style: Record<string,string>={};dataset:Record<string,string>={};children:Node[]=[];textContent='';hidden=false;disabled=false;value='';offsetWidth=80;name='';type='';placeholder='';autocomplete='';size=0;
 parent:Node|undefined;
 append(...nodes:Node[]){this.children.push(...nodes);for(const n of nodes)n.parent=this;}
 setAttribute(){} remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
}
function dom(){vi.stubGlobal('document',{createElement:()=>new Node()});const parent=new Node();return parent;}
afterEach(()=>vi.unstubAllGlobals());
const lobby=():LobbyMessage=>({protocolVersion:1,capacity:2,code:'ABCDEFGH',epoch:1,revision:1,runGeneration:0,stage:'lobby',host:'p1',players:[{slot:'p1',displayName:'Alex',connected:true,ready:false,restartRequested:false}]});
it('reuses four plain-text label nodes, separates overlaps, clips offscreen and disposes resources',()=>{
 const viewport=Object.assign(dom(),{clientWidth:800,clientHeight:600}),labels=new PlayerLabels(viewport as unknown as HTMLElement),camera=new OrthographicCamera(-10,10,7.5,-7.5,.1,100);
 camera.position.set(0,10,10);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const players=new Map(['p1','p2','p3','p4'].map(id=>[id as 'p1'|'p2'|'p3'|'p4',new PlayerView(0xffffff)]));
 labels.setName('p1','A & B');labels.update(players,camera);const nodes=viewport.children[0]!.children;
 expect(nodes.length).toBe(4);expect(nodes[0]!.textContent).toBe('A & B');expect(nodes[0]!.children.length).toBe(0);
 expect(new Set(nodes.map(n=>n.style.transform)).size).toBe(4);for(let i=0;i<20;i++)labels.update(players,camera);expect(viewport.children[0]!.children).toEqual(nodes);
 players.get('p4')!.group.position.x=100;labels.update(players,camera);expect(nodes[3]!.hidden).toBe(true);
 labels.setPresent(['p1','p2']); labels.update(players,camera); expect(viewport.children[0]!.children.length).toBe(2);
 labels.resetNames();expect(nodes[0]!.textContent).toBe('Player 1');labels.dispose();expect(viewport.children.length).toBe(0);players.forEach(p=>p.dispose());
});
it('submits optional normalized names only in lobby, echoes authoritative names and preserves draft typing',()=>{
 const parent=dom(),save=vi.fn(),input=new NameInput(parent as unknown as HTMLElement,save),data=lobby();input.update(data,'p1');
 const form=parent.children[0]!,field=form.children[0]!.children[0]!,button=form.children[1]!;
 expect(field.value).toBe('Alex');field.value=' Jose\u0301 ';input.update(structuredClone(data),'p1');expect(field.value).toBe(' Jose\u0301 ');
 form.dispatchEvent(new Event('submit',{cancelable:true}));expect(save).toHaveBeenCalledWith('José');field.value='<script>';form.dispatchEvent(new Event('submit',{cancelable:true}));expect(save).toHaveBeenCalledTimes(1);
 data.players[0]!.ready=true;input.update(data,'p1');expect(field.disabled&&button.disabled).toBe(true);
 input.clear();expect(form.hidden).toBe(true);input.dispose();expect(parent.children.length).toBe(0);
});
it('uses chosen names in existing failure text without recursive substitution or HTML interpretation',()=>{
 const names=new NamedFeedback(),data=lobby();data.players[0]!.displayName='P2';names.update(data);
 expect(names.format('P1 and p2 drowned.')).toBe('P2 and Player 2 drowned.');names.clear();expect(names.format('P1 drowned.')).toBe('Player 1 drowned.');
});
