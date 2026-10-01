import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inverseQuad,rasterizeProjected} from '../../src/ui/projective-raster.js';
import {nodeMatrix4,projectedQuad,quadPoint} from '../../src/ui/projection.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8);
const rectQuad=(w,h)=>[{x:0,y:0,weight:1},{x:w,y:0,weight:1},{x:w,y:h,weight:1},{x:0,y:h,weight:1}];
test('inverse homography recovers source UV across the perspective diagonal',()=>{
  const matrix=nodeMatrix4({x:20,y:10,w:100,h:80,pivot:{x:.5,y:.5}},{euler:{x:0,y:31,z:7},localPosition:{z:10}});
  const quad=projectedQuad(matrix,{x:0,y:0,w:100,h:80},{fieldOfView:60,referenceViewport:[200,200],canvasPlaneDistance:100}),m=inverseQuad(quad);
  for(const [u,v] of [[0,0],[1,1],[.499,.501],[.501,.499],[.15,.83]]){
    const p=quadPoint(quad,u,v),w=m[6]*p.x+m[7]*p.y+m[8];close((m[0]*p.x+m[1]*p.y+m[2])/w,u);close((m[3]*p.x+m[4]*p.y+m[5])/w,v);
  }
});
test('identity mapping preserves colored transparent pixels without adding a background',()=>{
  const rgba=new Uint8ClampedArray([255,0,0,255,0,255,0,128,0,0,255,64,0,0,0,0]);
  assert.deepEqual(rasterizeProjected(rgba,2,2,rectQuad(2,2),{x:0,y:0,width:2,height:2,scale:1}),rgba);
});
test('translucent surface alpha stays constant across former grid and diagonal seams',()=>{
  const rgba=new Uint8ClampedArray(4*4*4);for(let i=0;i<rgba.length;i+=4)rgba.set([35,110,240,91],i);
  const output=rasterizeProjected(rgba,4,4,rectQuad(48,48),{x:0,y:0,width:48,height:48,scale:1});
  for(let i=0;i<output.length;i+=4)assert.deepEqual([...output.slice(i,i+4)],[35,110,240,91]);
});
test('premultiplied bilinear sampling keeps invisible RGB from staining foreground edges',()=>{
  const source=new Uint8ClampedArray([255,0,0,255,0,0,255,0]);
  const output=rasterizeProjected(source,2,1,rectQuad(1,1),{x:0,y:0,width:1,height:1,scale:1});
  assert.deepEqual([...output],[255,0,0,128]);
});
test('outside a skewed quad remains transparent and a singular surface contributes no pixels',()=>{
  const rgba=new Uint8ClampedArray([200,100,25,255]),quad=[{x:2,y:0,weight:1},{x:4,y:0,weight:1},{x:2,y:4,weight:1},{x:0,y:4,weight:1}];
  const out=rasterizeProjected(rgba,1,1,quad,{x:0,y:0,width:4,height:4,scale:1});
  assert.equal(out[3],0);assert.equal(out[(1*4+2)*4+3],255);
  assert.deepEqual(rasterizeProjected(rgba,1,1,rectQuad(0,1),{x:0,y:0,width:1,height:1,scale:1}),new Uint8ClampedArray(4));
});
