import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
// Synthetic serialized UI records.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {UILibrary,UISession} from '../../src/ui/index.js';
import {node,pack,clip,controller,applyClip,id,ref,component,network} from './ui-fixture.mjs';
import {sampleClip,sampleObjectCurves,referenceNode,resolveNodeIndex,assignField} from '../../src/ui/runtime.js';
import {sequencePlan} from '../../src/ui/tween.js';
import {rectBox,affine,linearGroupLayout,layoutProperty} from '../../src/ui/layout.js';
import {visibleLines,textHeight,wrappingEnabled} from '../../src/ui/text-layout.js';
import {loadFonts} from '../../src/ui/renderer.js';

test('library loads product identities and returns isolated native node copies',async()=>{
  const n=network(),library=new UILibrary(n.index,'https://example.invalid/data/',n.fetch);
  const first=await library.loadPack('one'),reads=n.requests.length;first.pack.nodes[0].name='changed';
  const second=await library.loadPack('Box');assert.equal(second.pack.nodes[0].name,'Root');assert.equal(n.requests.length,reads);
  const selected=await library.loadController(second.pack,0);assert.equal(selected.id,id('controller'));assert.equal(selected.document.name,'Same');
  assert.equal(selected.clip(0).id,id('clip:A'));
});

test('a cancelled pack request does not poison another caller and a failed cached load retries',async()=>{
  const n=network();let first=true;
  const library=new UILibrary(n.index,'https://example.invalid/data/',async(...args)=>{if(first){first=false;throw Error('temporary');}return n.fetch(...args);});
  const abort=new AbortController();abort.abort();
  await assert.rejects(library.loadPack('one',{signal:abort.signal}),{name:'AbortError'});
  await assert.rejects(library.loadPack('one'),/temporary/);
  const loaded=await library.loadPack('one');assert.equal(loaded.pack.nodes[0].name,'Root');
});

test('library names must be unambiguous and the index format is checked',()=>{
  const n=network();n.index.assets.push({...n.index.assets[0],id:'two'});
  const library=new UILibrary(n.index,'https://example.invalid/data/');
  assert.throws(()=>library.find('Box'),/Ambiguous/);
  assert.throws(()=>new UILibrary({assets:[]},'https://example.invalid/data/'),/expected nnnotes.ui-library/);
});

test('custom fetch is called without a UILibrary receiver',async()=>{
  const n=network(),fetcher=async function(...args){assert.equal(this,undefined);return n.fetch(...args);};
  const library=await UILibrary.load('https://example.invalid/data/index.json',{fetch:fetcher});
  await library.loadPack('one');
});

test('binding duplicate sibling instances resolves object IDs and hierarchy references in the nearest subtree',()=>{
  const nodes=[node('Root','root'),node('Root/Item','left',[{class:'UIToggle',_previewIsOn:true,_checked:ref('left-check'),_unchecked:ref('left-off')}]),node('Root/Item/Check','left-check'),node('Root/Item/Off','left-off'),node('Root/Item','right',[{class:'UIToggle',_previewIsOn:false,_checked:{gameObject:'Root/Item/Check'}}]),node('Root/Item/Check','right-check')];
  const original=pack(nodes);const session=new UISession(original);const bound=session.prepare();
  assert.equal(bound.nodes[2].active,true);assert.equal(bound.nodes[3].active,false);assert.equal(bound.nodes[5].active,false);
  assert.equal(original.nodes[5].active,true);
  assert.equal(referenceNode(original,{gameObject:'Root/Item/Check'},4).index,5);
  assert.throws(()=>resolveNodeIndex(original,'Root/Item'),/Ambiguous/);
});

test('edits are immutable, reject prototype paths, and respect disabled component binding',()=>{
  const source=pack();source.nodes[0].components.push(component('Slider',{m_Value:3,m_MinValue:0,m_MaxValue:10,m_WholeNumbers:false}));
  const session=new UISession(source,{bindings:false});session.edit(id('root'),'CanvasGroup','m_Alpha',.7);
  assert.equal(session.prepare().nodes[0].components[0].fields.m_Alpha,.7);assert.equal(source.nodes[0].components[0].fields.m_Alpha,.3);
  assert.throws(()=>session.edit(id('root'),null,'__proto__.bad',true),/Invalid UI field/);
  assert.throws(()=>session.seek(Infinity),/finite/);session.reset();assert.equal(session.prepare().nodes[0].components[0].fields.m_Alpha,.3);
});

test('Trigger transitions, numeric crossfade and deterministic seek follow the saved parameter history',()=>{
  const session=new UISession(pack()).setController(0,controller()).playState('A');session.setParameter('Go',true);session.seek(.25);
  const mid=session.prepare();assert.ok(Math.abs(mid.nodes[0].components[0].fields.m_Alpha-.5)<1e-6);assert.equal(session.motion.runtime.parameters.Go,false);
  session.seek(1);assert.equal(session.prepare().nodes[0].components[0].fields.m_Alpha,1);
  session.seek(.25);assert.ok(Math.abs(session.prepare().nodes[0].components[0].fields.m_Alpha-.5)<1e-6);
});

test('unsupported motions report their limit and keep a finite preview clock without writing a pose',()=>{
  const exported=controller();exported.document.stateMachines[0].states[0].blendTrees=[[{clip:0,children:[1]}]];
  const session=new UISession(pack()).setController(0,exported).playState('A').update(.5),out=session.prepare();
  assert.ok(Number.isFinite(session.motion.runtime.current.normalized));assert.equal(out.nodes[0].components[0].fields.m_Alpha,.3);
  assert.ok(session.report.warnings.includes('blend_tree'));
});

test('discrete Sprite curves do not displace numeric constants and negative object indices clear a Sprite',()=>{
  const source=pack();source.nodes[0].components.push(component('Image',{m_Sprite:null,m_Color:{a:1}}));
  const data={streamed:{curveCount:1,discreteCurveCount:1,frames:[[0,[[0,0,0,0,1],[1,0,0,0,0]]]]},constant:[.2],bindings:[{path:'',class:'CanvasGroup',attribute:'m_Alpha'},{path:'',class:'Image',attribute:'m_Sprite',pptr:true},{path:'',class:'Image',attribute:'m_Color.a'}],pptrCurveMapping:[ref('sprite')]};
  assert.deepEqual(sampleClip(data,0),[1,.2]);assert.deepEqual(sampleObjectCurves(data,0),[0]);
  assert.equal(applyClip(source,data,0,0).objectApplied,1);assert.equal(source.nodes[0].components[1].fields.m_Color.a,.2);
  data.streamed.frames[0][1][1][4]=-1;applyClip(source,data,0,0);assert.equal(source.nodes[0].components[1].fields.m_Sprite,null);
});

test('clip poses only affect the chosen duplicate subtree and retain explicit missing-binding reasons',()=>{
  const source=pack([node('Root','root'),node('Root/Item','a',[{type:'CanvasGroup',m_Alpha:.2}]),node('Root/Item','b',[{type:'CanvasGroup',m_Alpha:.8}])]);
  assert.equal(applyClip(source,clip('set',1),1,0).applied,1);assert.equal(source.nodes[2].components[0].fields.m_Alpha,.8);
  assert.equal(applyClip(source,clip('set',1),'Root/Item',0).diagnostics[0].reason,'ambiguous_path');
  assert.equal(applyClip(source,clip('set',1),0,0).diagnostics[0].reason,'component_not_found');
});

test('serialized animation field names cannot write prototype or inherited fields',()=>{
  const source=pack(),original=Object.prototype.toString;
  const data={constant:[0],bindings:[{path:'',class:'CanvasGroup',attribute:'__proto__.toString'}]};
  assert.equal(applyClip(source,data,0,0).applied,0);assert.equal(Object.prototype.toString,original);
  assert.equal(assignField({},'constructor.prototype.toString',0),false);assert.equal(assignField({},'toString',0),false);
});

test('zero-duration sequence inserts stay parallel, seek uses the baseline, and unsupported callbacks are diagnostic',()=>{
  const animation={class:'DOTweenAnimation',animationType:2,targetIsSelf:true,isActive:true,isValid:true,duration:1,easeType:1,endValueV3:{x:10,y:0,z:0}};
  const source=pack([node('Root','root',[{class:'DOTweenSequence',_list:[{_commandType:0,_tweenAnimation:ref('one'),_tweenIndex:0,_duration:0},{_commandType:0,_tweenAnimation:ref('two'),_tweenIndex:0,_duration:0},{_commandType:1,_duration:0,_tweenEvent:{m_PersistentCalls:{m_Calls:[{m_CallState:1,m_Target:ref('one'),m_MethodName:'Unknown',m_Mode:5}]}}}]}]),node('Root/Child','one',[animation]),node('Root/Child','two',[structuredClone(animation)])]);
  assert.equal(sequencePlan(source,0).duration,1);assert.deepEqual(sequencePlan(source,0).items.slice(0,2).map(i=>i.start),[0,0]);
  const session=new UISession(source).selectSequence(0).seek(.5),out=session.prepare();
  assert.equal(out.nodes[1].localPosition.x,5);assert.equal(out.nodes[2].localPosition.x,5);
  assert.equal(session.report.diagnostics[0].reason,'sequence_callback_not_supported');
  session.seek(.25);assert.equal(session.prepare().nodes[1].localPosition.x,2.5);
  assert.equal(source.nodes[1].localPosition.x,0);
});

test('signed rects, flexible fixed-size cells, layout priority and trailing line feeds preserve geometry',()=>{
  const stretch=x=>({m_AnchorMin:{x:0,y:0},m_AnchorMax:{x:1,y:1},m_SizeDelta:{x,y:0}});
  const parent=rectBox(stretch(-120),100,100),child=rectBox(stretch(120),parent.w,parent.h);
  assert.equal(parent.w,-20);assert.deepEqual(affine.bounds(affine.mul(affine.box(parent),affine.box(child)),child.w,child.h),{minX:0,minY:0,maxX:100,maxY:100});
  const children=[0,1].map(i=>({i,size:[50,20],min:[0,0],preferred:[90,40],flexible:[0,0],scale:[1,1],pivot:{x:.5,y:.5}}));
  const boxes=linearGroupLayout({m_ChildForceExpandWidth:1,m_ChildAlignment:4},children,300,60,true);
  assert.equal(boxes.get(0).x,50);assert.equal(boxes.get(1).x,200);assert.equal(boxes.get(0).w,50);
  assert.equal(layoutProperty([{priority:1,preferred:-1},{priority:0,preferred:30}],'preferred'),30);
  assert.deepEqual(visibleLines(['A','','B','']),['A','','B']);assert.equal(textHeight(['A',''],20),20);assert.equal(wrappingEnabled({m_TextWrappingMode:0}),false);
});
test('a pack naming a browser font family loads no font resource',async()=>{
  const p=pack();p.browserFontFamily='"Noto Sans JP", sans-serif';p.objects.mono=()=>{throw Error('unexpected font load');};
  const loaded=await loadFonts(p);
  assert.equal(loaded.fontFamily,'"Noto Sans JP", sans-serif');assert.equal(loaded.gameFonts.size,0);
});

const validateUI=(change=()=>{})=>{
  const n=network(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ui-products-'));
  try{
    change(n);
    for(const [file,bytes] of n.files){const target=path.join(dir,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
    const r=spawnSync(process.execPath,[fileURLToPath(new URL('../../scripts/validate-data.mjs',import.meta.url)),dir],{encoding:'utf8'});
    return {status:r.status,text:r.stdout+r.stderr};
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
};
test('UI validation checks the product graph, binding names and library references',()=>{
  const valid=validateUI();assert.equal(valid.status,0,valid.text);assert.match(valid.text,/1\/1 UI products valid/);
  const edit=(n,fn)=>{const d=JSON.parse(new TextDecoder().decode(n.files.get(n.manifest.files['ui.json'].asset)));fn(d);n.manifest.files['ui.json']=n.asset(JSON.stringify(d));n.files.set('uipacks/one.json',new TextEncoder().encode(JSON.stringify(n.manifest)));};
  const bad=validateUI(n=>edit(n,d=>d.roots.push(d.roots[0])));assert.equal(bad.status,1);assert.match(bad.text,/duplicate object id/);
  const bindings=validateUI(n=>edit(n,d=>Object.values(Object.values(Object.values(d.bindings)[0])[0])[0].pop()));assert.equal(bindings.status,1);assert.match(bindings.text,/names, the clip has/);
  const missing=validateUI(n=>{n.index.controllers=[{id:'ui:99999',name:'Missing',manifest:'uipacks/one.json'}];n.files.set('index.json',new TextEncoder().encode(JSON.stringify(n.index)));});assert.equal(missing.status,1);assert.match(missing.text,/not in the store/);
});
