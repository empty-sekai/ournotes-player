import test from 'node:test';
import assert from 'node:assert/strict';
import {previewSpriteGeometryPlan,previewSpriteAspect,spriteCropPlan} from '../../src/ui/sprite-geometry.js';

test('trimmed bitmap uses original Sprite aspect and restores upward trim offset',()=>{
  // Synthetic geometry: no extracted game records are bundled with the test.
  const geometry={rect:{x:9,y:7,width:120.5,height:200.25},
    textureRect:{x:30.25,y:40.5,width:60.5,height:140.25},
    textureRectOffset:{x:20.75,y:10.5},pixelsPerUnit:100};
  const plan=previewSpriteGeometryPlan(geometry,61,141);
  assert.equal(plan.aspect,geometry.rect.width/geometry.rect.height);
  assert.notEqual(plan.aspect,61/141);
  assert.deepEqual(plan.canvas,{width:121,height:201});
  assert.equal(plan.source.x,.25);
  assert.equal(plan.source.y,.25);
  assert.equal(plan.destination.x,20.75);
  assert.equal(plan.destination.y,50.25);
  assert.equal(plan.destination.height,geometry.textureRect.height);
});

test('integer crops restore padding identically to the full texture Sprite path',()=>{
  const geometry={rect:{width:100,height:200},textureRect:{x:30,y:40,width:60,height:140},textureRectOffset:{x:20,y:10},pixelsPerUnit:64};
  const plan=previewSpriteGeometryPlan(geometry,60,140);
  assert.deepEqual(plan.source,{x:0,y:0,width:60,height:140});
  assert.deepEqual(plan.destination,{x:20,y:50,width:60,height:140});
  assert.equal(plan.pixelsPerUnit,64);
  assert.equal(previewSpriteAspect(geometry,{width:60,height:140}),.5);
});

test('legacy external bitmap bindings keep their bitmap aspect',()=>{
  assert.equal(previewSpriteAspect(undefined,{width:75,height:100}),.75);
});

test('reject mismatched or incomplete original Sprite metadata',()=>{
  const geometry={rect:{width:100,height:200},textureRect:{x:30,y:40,width:60,height:140},textureRectOffset:{x:20,y:10}};
  assert.throws(()=>previewSpriteGeometryPlan(geometry,100,200),/differs/);
  assert.throws(()=>previewSpriteGeometryPlan({...geometry,textureRectOffset:null},60,140),/requires original/);
  assert.throws(()=>previewSpriteGeometryPlan({...geometry,rect:{width:NaN,height:200}},60,140),/rect.width/);
});

test('rotated or downscaled exports require a separate explicit bitmap contract',()=>{
  const geometry={rect:{width:100,height:200},textureRect:{x:30,y:40,width:60,height:140},textureRectOffset:{x:20,y:10}};
  assert.throws(()=>previewSpriteGeometryPlan({...geometry,settingsRaw:5},60,140),/unrotated, unscaled/);
  assert.throws(()=>previewSpriteGeometryPlan({...geometry,downscaleMultiplier:2},60,140),/unrotated, unscaled/);
});

test('atlas Sprite crop: integer rectangle with a two-pixel halo around the float textureRect',()=>{
  // image 64 x 64, Unity rect from the bottom: top = 64 - 10.5 - 20.25 = 33.25
  const plan=spriteCropPlan(64,64,{x:12.25,y:10.5,width:30.5,height:20.25});
  assert.deepEqual([plan.x,plan.y,plan.width,plan.height],[10,31,35,25]);
  assert.deepEqual(plan.copy,{sx:10,sy:31,w:35,h:25,dx:0,dy:0});
  assert.deepEqual(plan.source,{x:2.25,y:2.25});
});
test('atlas Sprite crop: the same texels at another offset of a larger atlas sample at the same coordinates',()=>{
  const small=spriteCropPlan(64,64,{x:12.25,y:10.5,width:30.5,height:20.25}),
    large=spriteCropPlan(4096,2048,{x:3012.25,y:1994.5,width:30.5,height:20.25});
  assert.deepEqual(large.source,small.source);
  assert.deepEqual([large.width,large.height],[small.width,small.height]);
});
test('atlas Sprite crop: a halo leaving the texture copies only the part inside it',()=>{
  const plan=spriteCropPlan(32,16,{x:0,y:0,width:32,height:16});
  assert.deepEqual([plan.x,plan.y,plan.width,plan.height],[-2,-2,36,20]);
  assert.deepEqual(plan.copy,{sx:0,sy:0,w:32,h:16,dx:2,dy:2});
  assert.deepEqual(plan.source,{x:2,y:2});
});
