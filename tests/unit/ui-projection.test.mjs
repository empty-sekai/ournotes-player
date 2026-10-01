import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cameraProjection,validateProjection,nodeMatrix4,multiply4,identity4,projectedQuad,quadPoint,outOfPlane} from '../../src/ui/projection.js';
import {Renderer} from '../../src/ui/renderer.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const camera=()=>cameraProjection({orthographic:false,'field of view':90,'near clip plane':.1,m_NormalizedViewPortRect:{x:0,y:0,width:1,height:1}}, {m_RenderMode:1,m_PlaneDistance:10},[100,100]);
test('source Camera/Canvas parameters are required and unsupported modes fail explicitly',()=>{
  assert.deepEqual(camera(),{fieldOfView:90,referenceViewport:[100,100],canvasPlaneDistance:10,nearClipPlane:.1});
  assert.throws(()=>cameraProjection({orthographic:true},{m_RenderMode:1},[100,100]),/perspective/);
  assert.throws(()=>cameraProjection({orthographic:false,m_LensShift:{x:1,y:0}},{m_RenderMode:1},[100,100]),/shifted lens/);
  assert.throws(()=>validateProjection({fieldOfView:90,referenceViewport:[0,100],canvasPlaneDistance:10}),/nonpositive/);
  assert.throws(()=>validateProjection({fieldOfView:NaN,referenceViewport:[100,100],canvasPlaneDistance:10}),/invalid/);
});
test('zero-depth geometry is identity and positive depth recedes toward the optical center',()=>{
  const rect={x:10,y:20,w:20,h:30};let quad=projectedQuad(identity4(),rect,camera());
  near(quad[0].x,10);near(quad[0].y,20);near(quad[2].x,30);near(quad[2].y,50);
  const m=identity4();m[11]=50;quad=projectedQuad(m,rect,camera());
  near(quad[0].x,30);near(quad[0].y,35);near(quad[2].x,40);
  m[11]=-50;assert.throws(()=>projectedQuad(m,rect,camera()),/near plane/);
});
test('Unity quaternion rotates around the actual RectTransform pivot and composes parents',()=>{
  const box={x:30,y:40,w:20,h:10,pivot:{x:.5,y:.5}},q={x:0,y:Math.SQRT1_2,z:0,w:Math.SQRT1_2};
  const m=nodeMatrix4(box,{localRotation:q,localPosition:{z:0}}),quad=projectedQuad(m,{x:0,y:0,w:20,h:10},camera());
  near(quad[0].x,50-10*50/60);near(quad[0].y,50-10*50/60);near(quad[1].x,50-10*50/40);near(quad[1].y,50-10*50/40);
  const parent=identity4();parent[3]=10;near(projectedQuad(multiply4(parent,m),{x:0,y:0,w:20,h:10},camera())[0].x,50);
  const e=nodeMatrix4(box,{euler:{x:0,y:90,z:0}});e.forEach((v,i)=>near(v,m[i]));
  assert.equal(outOfPlane({localPosition:{z:3.8e-6}}),false);assert.equal(outOfPlane({localRotation:q}),true);
});
test('homogeneous interpolation matches projection of an interior source point',()=>{
  const box={x:0,y:0,w:100,h:100,pivot:{x:.5,y:.5}},m=nodeMatrix4(box,{euler:{x:0,y:35,z:8},localPosition:{z:12}}),quad=projectedQuad(m,{x:0,y:0,w:100,h:100},camera());
  const sample=quadPoint(quad,.23,.7),actual=projectedQuad(m,{x:23,y:70,w:0,h:0},camera())[0];near(sample.x,actual.x);near(sample.y,actual.y);
});

function context(){return {globalAlpha:1,save(){},restore(){},scale(){},translate(){},rotate(){},setTransform(){},getTransform(){return {};},transform(){},drawImage(){},fillRect(){},beginPath(){},rect(){},clip(){},moveTo(){},lineTo(){},closePath(){}};}
globalThis.document={baseURI:'https://example.invalid/',createElement:()=>({width:1,height:1,getContext:()=>context()})};
const node=(path,id,w,h,components=[],pos={x:0,y:0})=>({path,nodeId:id,active:true,components,rect:{m_SizeDelta:{x:w,y:h},m_AnchorMin:{x:0,y:1},m_AnchorMax:{x:0,y:1},m_AnchoredPosition:pos,m_Pivot:{x:0,y:1}}});
const image={class:'Image',m_Color:{r:1,g:1,b:1,a:1}};
test('content framing crops transparent root space while projected container regions retain source order',async()=>{
  const root=node('Root','root',100,100),slot=node('Root/Slot','slot',20,40,[],{x:20,y:-30});slot.euler={x:0,y:30,z:0};
  const front=node('Root/Slot/Foreground','fg',24,44,[image],{x:-2,y:2}),hidden=node('Root/Slot/Hidden','hidden',50,50,[image]);hidden.active=false;
  const pack={document:{nodes:[root,slot,front,hidden]},resources:{}},before=JSON.stringify(pack);
  const result=await new Renderer(pack,{projection:camera(),framing:'content'}).render();
  assert.equal(result.metrics.drawn,1);assert.equal(result.padding,24);assert.equal(result.width,100);
  assert.ok(result.bounds.minX>0&&result.bounds.minY>0&&result.bounds.maxX<100&&result.bounds.maxY<100);
  assert.equal(result.regions.slot.length,4);assert.ok(result.regions.slot[0].y!==result.regions.slot[1].y);assert.equal(result.regions.hidden,undefined);
  assert.ok(result.bounds.minX<Math.min(...result.regions.slot.map(p=>p.x)),'foreground extends beyond slot box');
  assert.equal(JSON.stringify(pack),before);
});
test('nested tilted surfaces and cross-mask projective composition report limits instead of silently flattening',async()=>{
  const root=node('Root','root',100,100),slot=node('Root/Slot','slot',20,40);slot.euler={x:0,y:30,z:0};
  const child=node('Root/Slot/Child','child',10,10,[image]);child.euler={x:0,y:20,z:0};
  await assert.rejects(new Renderer({document:{nodes:[root,slot,child]},resources:{}},{projection:camera()}).render(),/nested nonplanar/);
  root.components=[{class:'RectMask2D',m_Enabled:1}];child.euler={x:0,y:0,z:0};
  await assert.rejects(new Renderer({document:{nodes:[root,slot,child]},resources:{}},{projection:camera()}).render(),/inside a mask/);
});
