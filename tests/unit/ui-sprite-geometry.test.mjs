import test from 'node:test';
import assert from 'node:assert/strict';
import {previewSpriteGeometryPlan,previewSpriteAspect} from '../../src/ui/sprite-geometry.js';

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
