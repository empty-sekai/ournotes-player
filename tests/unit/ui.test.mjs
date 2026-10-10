// Synthetic serialized records only; no game fixtures or artwork.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {UILibrary,UISession} from '../../src/ui/index.js';
import {resourceURLs} from '../../src/ui/library.js';
import {applyClip,sampleClip,sampleObjectCurves,referenceNode,resolveNodeIndex,mergeResources,assignField} from '../../src/ui/runtime.js';
import {sequencePlan,SequenceRuntime} from '../../src/ui/tween.js';
import {rectBox,affine,linearGroupLayout,layoutProperty} from '../../src/ui/layout.js';
import {visibleLines,textHeight,wrappingEnabled} from '../../src/ui/text-layout.js';
import {loadFonts} from '../../src/ui/renderer.js';

const node=(path,id,components=[])=>({path,name:path.split('/').at(-1),nodeId:id,active:true,components,localScale:{x:1,y:1,z:1},localPosition:{x:0,y:0,z:0}});
const pack=()=>({document:{nodes:[node('Root','root',[{type:'CanvasGroup',m_Alpha:.3}])]},resources:{}});
const clip=(name,value)=>({clip:name,startTime:0,stopTime:1,bindings:[{path:'',class:'CanvasGroup',attribute:'m_Alpha'}],constant:[value]});
const controller=()=>({document:{layers:[{stateMachine:0}],parameters:[{name:'Go',type:9,index:0}],clips:[clip('A',0),clip('B',1)],stateMachines:[{defaultState:0,anyStateTransitions:[],states:[
  {name:'A',speed:1,writeDefaultValues:true,blendTrees:[[{clip:0,children:[]}]],transitions:[{destination:1,conditions:[{mode:1,event:'Go'}],duration:.5,fixedDuration:true}]},
  {name:'B',speed:1,writeDefaultValues:true,blendTrees:[[{clip:1,children:[]}]],transitions:[]}
]}]}});

test('library normalizes resource bases, caches copies and handles same-named controllers by ID',async()=>{
  const index={assets:[{id:'one',key:'Box',name:'Box',file:'packs/one.json',kind:'prefab'}],controllers:[{id:'c1',name:'Same',file:'controllers/one.json'},{id:'c2',name:'Same',file:'controllers/two.json'}]};
  let reads=0;const fetcher=async url=>{reads++;return {ok:true,json:async()=>url.includes('/controllers/')?{document:{name:'chosen'},resourceBase:'../',resources:{textures:{t:'textures/a.png'},fontMetricsByAsset:{Font:'fonts/f.json'}}}:{...pack(),resourceBase:'../',document:{nodes:[node('Root','root',[{class:'Animator',m_Controller:{id:'c2',name:'Same'}}])]}}};};
  const library=new UILibrary(index,'https://example.invalid/data/',fetcher);
  const first=await library.loadPack('one');first.pack.document.nodes[0].name='changed';
  const second=await library.loadPack('Box');assert.equal(second.pack.document.nodes[0].name,'Root');assert.equal(reads,1);
  assert.equal(second.assetBase,'https://example.invalid/data/');
  const selected=await library.loadController(second.pack,0,second.entry);assert.equal(selected.document.name,'chosen');
  assert.equal(selected.resources.fontMetricsByAsset.Font,'https://example.invalid/data/fonts/f.json');
  assert.equal(selected.resources.textures.t,'https://example.invalid/data/textures/a.png');
});

test('a cancelled pack request does not poison another caller and a failed cached load retries',async()=>{
  const index={assets:[{id:'one',file:'packs/one.json',kind:'prefab'}]};let reads=0;
  const library=new UILibrary(index,'https://example.invalid/',async(_,{signal}={})=>{reads++;if(signal?.aborted)throw signal.reason;if(reads===2)throw Error('temporary');return {ok:true,json:async()=>pack()};});
  const abort=new AbortController();abort.abort();
  await assert.rejects(library.loadPack('one',{signal:abort.signal}),{name:'AbortError'});
  await assert.rejects(library.loadPack('one'),/temporary/);
  await library.loadPack('one');assert.equal(reads,3);
});

test('ambiguous names are explicit and resource URL conversion leaves the input untouched',()=>{
  const library=new UILibrary({assets:[{id:'a',name:'Same'},{id:'b',name:'Same'}]},'https://example.invalid/');
  assert.throws(()=>library.find('Same'),/Ambiguous/);
  const input={textures:{a:'../a.png'},fonts:{a:'font.ttf'},fontMetricsByAsset:{A:'a.json'}};
  assert.equal(resourceURLs(input,'https://example.invalid/data/').textures.a,'https://example.invalid/a.png');assert.equal(input.textures.a,'../a.png');
});

test('custom fetch is called as a function rather than with a UILibrary receiver',async()=>{
  const fetcher=async function(){assert.equal(this,undefined);return {ok:true,json:async()=>pack()};};
  const library=new UILibrary({assets:[{id:'one',file:'one.json'}]},'https://example.invalid/',fetcher);
  await library.loadPack('one');
});

test('binding duplicate sibling instances resolves actual IDs and legacy references in the nearest subtree',()=>{
  const nodes=[node('Root','root'),node('Root/Item','left',[{class:'UIToggle',_previewIsOn:true,_checked:{nodeId:'left-check',gameObject:'Root/Item/Check'},_unchecked:{nodeId:'left-off'}}]),node('Root/Item/Check','left-check'),node('Root/Item/Off','left-off'),node('Root/Item','right',[{class:'UIToggle',_previewIsOn:false,_checked:{gameObject:'Root/Item/Check'}}]),node('Root/Item/Check','right-check')];
  const original={document:{nodes},resources:{}};const session=new UISession(original);const bound=session.prepare();
  assert.equal(bound.document.nodes[2].active,true);assert.equal(bound.document.nodes[3].active,false);assert.equal(bound.document.nodes[5].active,false);
  assert.equal(original.document.nodes[5].active,true);
  assert.equal(referenceNode(original,{gameObject:'Root/Item/Check'},4).index,5);
  assert.throws(()=>resolveNodeIndex(original,'Root/Item'),/Ambiguous/);
});

test('edits are immutable, reject prototype paths, and respect disabled component binding',()=>{
  const source=pack();source.document.nodes[0].components.push({class:'Slider',m_Value:3,m_MinValue:0,m_MaxValue:10,m_WholeNumbers:false});
  const session=new UISession(source,{bindings:false});session.edit('root','CanvasGroup','m_Alpha',.7);
  assert.equal(session.prepare().document.nodes[0].components[0].m_Alpha,.7);assert.equal(source.document.nodes[0].components[0].m_Alpha,.3);
  assert.throws(()=>session.edit('root',null,'__proto__.bad',true),/Invalid UI field/);
  assert.throws(()=>session.seek(Infinity),/finite/);session.reset();assert.equal(session.prepare().document.nodes[0].components[0].m_Alpha,.3);
});

test('Trigger transitions, numeric crossfade and deterministic seek follow the saved parameter history',()=>{
  const session=new UISession(pack()).setController(0,controller()).playState('A');session.setParameter('Go',true);session.seek(.25);
  const mid=session.prepare();assert.ok(Math.abs(mid.document.nodes[0].components[0].m_Alpha-.5)<1e-6);assert.equal(session.motion.runtime.parameters.Go,false);
  session.seek(1);assert.equal(session.prepare().document.nodes[0].components[0].m_Alpha,1);
  session.seek(.25);assert.ok(Math.abs(session.prepare().document.nodes[0].components[0].m_Alpha-.5)<1e-6);
});

test('unsupported motions report their limit and keep a finite preview clock without writing a pose',()=>{
  const exported=controller();exported.document.stateMachines[0].states[0].blendTrees=[[{clip:0,children:[1]}]];
  const session=new UISession(pack()).setController(0,exported).playState('A').update(.5),out=session.prepare();
  assert.ok(Number.isFinite(session.motion.runtime.current.normalized));assert.equal(out.document.nodes[0].components[0].m_Alpha,.3);
  assert.ok(session.report.warnings.includes('blend_tree'));
});

test('discrete Sprite curves do not displace numeric constants and negative object indices clear a Sprite',()=>{
  const source=pack();source.document.nodes[0].components.push({class:'Image',m_Sprite:null,m_Color:{a:1}});
  const data={streamed:{curveCount:1,discreteCurveCount:1,frames:[[0,[[0,0,0,0,1],[1,0,0,0,0]]]]},constant:[.2],bindings:[{path:'',class:'CanvasGroup',attribute:'m_Alpha'},{path:'',class:'Image',attribute:'m_Sprite',pptr:true},{path:'',class:'Image',attribute:'m_Color.a'}],pptrCurveMapping:[{spriteRef:'synthetic'}]};
  assert.deepEqual(sampleClip(data,0),[1,.2]);assert.deepEqual(sampleObjectCurves(data,0),[0]);
  assert.equal(applyClip(source,data,0,0).objectApplied,1);assert.equal(source.document.nodes[0].components[1].m_Color.a,.2);
  data.streamed.frames[0][1][1][4]=-1;applyClip(source,data,0,0);assert.equal(source.document.nodes[0].components[1].m_Sprite,null);
});

test('clip poses only affect the chosen duplicate subtree and retain explicit missing-binding reasons',()=>{
  const source={document:{nodes:[node('Root','root'),node('Root/Item','a',[{type:'CanvasGroup',m_Alpha:.2}]),node('Root/Item','b',[{type:'CanvasGroup',m_Alpha:.8}])]},resources:{}};
  assert.equal(applyClip(source,clip('set',1),1,0).applied,1);assert.equal(source.document.nodes[2].components[0].m_Alpha,.8);
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
  const source={document:{nodes:[node('Root','root',[{class:'DOTweenSequence',_list:[{_commandType:0,_tweenAnimation:{nodeId:'one'},_tweenIndex:0,_duration:0},{_commandType:0,_tweenAnimation:{nodeId:'two'},_tweenIndex:0,_duration:0},{_commandType:1,_duration:0,_tweenEvent:{m_PersistentCalls:{m_Calls:[{m_CallState:1,m_Target:{nodeId:'one'},m_MethodName:'Unknown',m_Mode:5}]}}}]}]),node('Root/Child','one',[animation]),node('Root/Child','two',[structuredClone(animation)])]},resources:{}};
  assert.equal(sequencePlan(source,0).duration,1);assert.deepEqual(sequencePlan(source,0).items.slice(0,2).map(i=>i.start),[0,0]);
  const session=new UISession(source).selectSequence(0).seek(.5),out=session.prepare();
  assert.equal(out.document.nodes[1].localPosition.x,5);assert.equal(out.document.nodes[2].localPosition.x,5);
  assert.equal(session.report.diagnostics[0].reason,'sequence_callback_not_supported');
  session.seek(.25);assert.equal(session.prepare().document.nodes[1].localPosition.x,2.5);
  assert.equal(source.document.nodes[1].localPosition.x,0);
});

test('signed rects, flexible fixed-size cells, layout priority and trailing line feeds preserve geometry',()=>{
  const stretch=x=>({m_AnchorMin:{x:0,y:0},m_AnchorMax:{x:1,y:1},m_SizeDelta:{x,y:0}});
  const parent=rectBox(stretch(-120),100,100),child=rectBox(stretch(120),parent.w,parent.h);
  assert.equal(parent.w,-20);assert.deepEqual(affine.bounds(affine.mul(affine.box(parent),affine.box(child)),child.w,child.h),{minX:0,minY:0,maxX:100,maxY:100});
  const children=[0,1].map(i=>({i,size:[50,20],min:[0,0],preferred:[90,40],flexible:[0,0],scale:[1,1],pivot:{x:.5,y:.5}}));
  const boxes=linearGroupLayout({class:'HorizontalLayoutGroup',m_ChildForceExpandWidth:1,m_ChildAlignment:4},children,300,60);
  assert.equal(boxes.get(0).x,50);assert.equal(boxes.get(1).x,200);assert.equal(boxes.get(0).w,50);
  assert.equal(layoutProperty([{priority:1,preferred:-1},{priority:0,preferred:30}],'preferred'),30);
  assert.deepEqual(visibleLines(['A','','B','']),['A','','B']);assert.equal(textHeight(['A',''],20),20);assert.equal(wrappingEnabled({m_TextWrappingMode:0}),false);
  const merged=pack();mergeResources(merged,{fontMetricsByAsset:{A:'https://example.invalid/a.json'}});assert.equal(merged.resources.fontMetricsByAsset.A,'https://example.invalid/a.json');
});
test('a pack naming a browser font family loads no font resource',async()=>{
  const nodes=[{components:[{class:'TextMeshProUGUI',m_fontAsset:{name:'VibeMO SDF'}}]}],resolved=[];
  const resources={browserFontFamily:'"Noto Sans JP", sans-serif',fonts:{FZLTH:'fonts/a.ttf'},fontMetrics:'fonts/vibemo.json'};
  const loaded=await loadFonts({document:{nodes},resources},file=>{resolved.push(file);return file;});
  assert.equal(loaded.fontFamily,'"Noto Sans JP", sans-serif');
  assert.equal(loaded.gameFonts.size,0);
  assert.deepEqual(resolved,[]);
});
