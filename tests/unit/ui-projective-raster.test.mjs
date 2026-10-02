import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inverseQuad,rasterizeProjected,projectiveSurface} from '../../src/ui/projective-raster.js';
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
test('GPU composition uses one shared-vertex fan and premultiplied source alpha without blending',()=>{
  const calls=[],noop=()=>{},gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,FLOAT:6,TEXTURE_2D:7,TEXTURE_WRAP_S:8,TEXTURE_WRAP_T:9,CLAMP_TO_EDGE:10,TEXTURE_MIN_FILTER:11,TEXTURE_MAG_FILTER:12,LINEAR:13,UNPACK_PREMULTIPLY_ALPHA_WEBGL:14,UNPACK_FLIP_Y_WEBGL:15,BLEND:16,MAX_TEXTURE_SIZE:17,COLOR_BUFFER_BIT:18,STREAM_DRAW:19,RGBA:20,UNSIGNED_BYTE:21,TRIANGLE_FAN:22,
    createShader:()=>({}),shaderSource:noop,compileShader:noop,getShaderParameter:()=>true,createProgram:()=>({}),attachShader:noop,linkProgram:noop,getProgramParameter:()=>true,deleteShader:noop,useProgram:noop,createBuffer:()=>({}),createTexture:()=>({}),bindBuffer:noop,getAttribLocation:()=>0,enableVertexAttribArray:noop,vertexAttribPointer:noop,bindTexture:noop,texParameteri:noop,uniform1i:noop,getUniformLocation:()=>0,isContextLost:()=>false,getParameter:()=>4096,viewport:noop,clearColor:noop,clear:noop,
    pixelStorei:(...args)=>calls.push(['pixelStore',...args]),disable:(...args)=>calls.push(['disable',...args]),bufferData:(_target,data)=>calls.push(['vertices',...data]),texImage2D:(...args)=>calls.push(['texture',args.at(-1)]),drawArrays:(...args)=>calls.push(['draw',...args])};
  globalThis.document={createElement:()=>({width:1,height:1,getContext:mode=>{assert.equal(mode,'webgl2');return gl;}})};
  const image={width:2,height:2},result=projectiveSurface(image,rectQuad(4,4));
  assert.equal(result.canvas.width,4);assert.equal(result.canvas.height,4);
  assert.ok(calls.some(c=>c[0]==='pixelStore'&&c[1]===gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL&&c[2]===true));
  assert.ok(calls.some(c=>c[0]==='disable'&&c[1]===gl.BLEND));
  assert.deepEqual(calls.filter(c=>c[0]==='draw'),[['draw',gl.TRIANGLE_FAN,0,4]]);
  assert.deepEqual(calls.find(c=>c[0]==='vertices').slice(1,6),[-1,1,1,0,0]);
  assert.deepEqual(calls.find(c=>c[0]==='texture'),['texture',image]);
});
