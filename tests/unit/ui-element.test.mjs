import assert from 'node:assert/strict';
import {test} from 'node:test';

class Element extends EventTarget {
  constructor(){super();this.attributes=new Map();this.isConnected=false;}
  attachShadow(){return this.shadowRoot={append(){}};}
  setAttribute(name,value){const old=this.getAttribute(name);this.attributes.set(name,String(value));if(this.constructor.observedAttributes?.includes(name))this.attributeChangedCallback(name,old,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  hasAttribute(name){return this.attributes.has(name);}
  removeAttribute(name){const old=this.getAttribute(name);this.attributes.delete(name);this.attributeChangedCallback(name,old,null);}
}
const canvas=()=>({tagName:'CANVAS',style:{},width:1,height:1,getContext(){return {globalAlpha:1,save(){},restore(){},scale(){},translate(){},rotate(){},drawImage(){}};}});
globalThis.HTMLElement=Element;
globalThis.document={baseURI:'https://example.invalid/',createElement:name=>name==='canvas'?canvas():{style:{}}};
globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{};
const {OurnotesUIElement}=await import('../../src/ui/element.js');
const {UIPlayer}=await import('../../src/ui/player.js');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const fakePlayer=()=>({destroyed:false,destroy(){this.destroyed=true;},addEventListener(){}});
const tick=()=>new Promise(r=>setTimeout(r,0));
const pack=()=>({document:{nodes:[{path:'Root',name:'Root',nodeId:'root',active:true,components:[],rect:{m_SizeDelta:{x:100,y:50}}}]},resources:{}});

test('ready captured before connecting settles on the first load',async t=>{
  const result=fakePlayer();t.mock.method(UIPlayer,'create',async()=>result);
  const element=new OurnotesUIElement(),ready=element.ready;element.src='pack.json';element.isConnected=true;element.connectedCallback();
  assert.equal(await ready,result);
});

test('disconnecting an in-flight element rejects the old ready and reconnecting starts a fresh load',async t=>{
  const old=deferred(),fresh=fakePlayer();let loads=0;t.mock.method(UIPlayer,'create',()=>++loads===1?old.promise:Promise.resolve(fresh));
  const element=new OurnotesUIElement();element.src='pack.json';element.isConnected=true;element.connectedCallback();const ready=element.ready;
  element.isConnected=false;element.disconnectedCallback();await tick();await assert.rejects(ready,{name:'AbortError'});
  element.isConnected=true;element.connectedCallback();assert.equal(await element.ready,fresh);assert.equal(loads,2);
  const stale=fakePlayer();old.resolve(stale);await tick();assert.equal(stale.destroyed,true);assert.equal(element.player,fresh);
});

test('a superseded source cannot replace the new player or leave its ready pending',async t=>{
  const old=deferred(),fresh=fakePlayer();let loads=0;t.mock.method(UIPlayer,'create',()=>++loads===1?old.promise:Promise.resolve(fresh));
  const element=new OurnotesUIElement();element.isConnected=true;element.src='old.json';const ready=element.ready;element.src='new.json';
  await assert.rejects(ready,{name:'AbortError'});assert.equal(await element.ready,fresh);
  const stale=fakePlayer();old.resolve(stale);await tick();assert.equal(stale.destroyed,true);
});

test('UIPlayer loading only emits ready for the newest document',async()=>{
  const player=new UIPlayer(canvas()),old=deferred();let renders=0,ready=0;player.render=()=>++renders===1?old.promise:Promise.resolve(null);player.addEventListener('ready',()=>ready++);
  const a=player.load(pack());await player.load(pack());old.resolve(null);await a;assert.equal(ready,1);player.destroy();
});

test('a late controller cannot be attached to a replacement session',async()=>{
  const old=deferred(),player=new UIPlayer(canvas(),{library:{loadController:()=>old.promise}});await player.load(pack());
  const pending=player.controller(0);await player.load(pack());old.resolve({document:{}});
  await assert.rejects(pending,{name:'AbortError'});assert.equal(player.session.controllers.size,0);player.destroy();
});

test('an old awaited playback frame cannot schedule another loop after pause and restart',async t=>{
  const queued=new Map();let serial=0;t.mock.method(globalThis,'requestAnimationFrame',fn=>{queued.set(++serial,fn);return serial;});t.mock.method(globalThis,'cancelAnimationFrame',id=>queued.delete(id));
  const player=new UIPlayer(canvas()),gate=deferred();player.session={time:0,motion:{kind:'clip',clip:{loopTime:true}},update(){}};player.render=()=>gate.promise;
  player.play();const first=queued.get(1);queued.delete(1);const pending=first(performance.now()+50);player.pause();player.play();gate.resolve(null);await pending;
  assert.equal(queued.size,1);assert.ok(queued.has(2));player.destroy();assert.equal(queued.size,0);
});
