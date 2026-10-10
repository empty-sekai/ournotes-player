// Sprite bitmaps exported from textureRect are trimmed, while Unity Image and
// UIAddressableImage use Sprite.rect. Preserve the original logical rectangle.
const finite=(value,label)=>{
  if(!Number.isFinite(value))throw Error(`Invalid preview Sprite ${label}`);
  return value;
};
export function previewSpriteGeometryPlan(geometry,imageWidth,imageHeight){
  const r=geometry?.rect,t=geometry?.textureRect,o=geometry?.textureRectOffset;
  if(!r||!t||!o)throw Error('Preview Sprite requires original rect, textureRect and textureRectOffset');
  const settings=geometry.settingsRaw??0;
  if(!Number.isSafeInteger(settings)||settings<0||settings&1&&(settings>>2)&15||(geometry.downscaleMultiplier??1)!==1)throw Error('Preview Sprite bitmap contract requires unrotated, unscaled source metadata');
  const width=finite(r.width,'rect.width'),height=finite(r.height,'rect.height');
  const x=finite(t.x,'textureRect.x'),y=finite(t.y,'textureRect.y'),tw=finite(t.width,'textureRect.width'),th=finite(t.height,'textureRect.height');
  const ox=finite(o.x,'textureRectOffset.x'),oy=finite(o.y,'textureRectOffset.y');
  if(width<=0||height<=0||tw<=0||th<=0||x<0||y<0)throw Error('Preview Sprite rectangle must be positive');
  const cropWidth=Math.ceil(x+tw)-Math.floor(x),cropHeight=Math.ceil(y+th)-Math.floor(y);
  // The asset service exports floor(min)..ceil(max), including fractional edge
  // texels. Sample the original float rectangle inside that integer crop.
  if(imageWidth!==cropWidth||imageHeight!==cropHeight)throw Error('Preview Sprite bitmap differs from original textureRect');
  const pixelsPerUnit=geometry.pixelsPerUnit===undefined?100:finite(geometry.pixelsPerUnit,'pixelsPerUnit');
  if(pixelsPerUnit<=0)throw Error('Preview Sprite pixelsPerUnit must be positive');
  return {
    canvas:{width:Math.ceil(width),height:Math.ceil(height)},
    source:{x:x-Math.floor(x),y:Math.ceil(y+th)-y-th,width:tw,height:th},
    // Unity texture/offset coordinates point upward. Canvas points downward;
    // use the same conversion as Renderer.sprite's full-texture path.
    destination:{x:ox,y:Math.ceil(height)-oy-th,width:tw,height:th},
    aspect:width/height,pixelsPerUnit,border:geometry.border||{x:0,y:0,z:0,w:0},
  };
}

export function previewSpriteAspect(geometry,image){
  if(geometry)return previewSpriteGeometryPlan(geometry,image.width,image.height).aspect;
  return image.width/image.height;
}

// An atlas Sprite is sampled from an integer crop around its float textureRect, with a two-pixel halo, so the
// sampling coordinates stay small and do not depend on the atlas size. `copy` is the part of the crop inside the
// image (the renderer repeats its edge texels into the rest); `source` is the Sprite's top-left corner in the crop.
export function spriteCropPlan(imageWidth,imageHeight,r){
  const top=imageHeight-r.y-r.height,x=Math.floor(r.x)-2,y=Math.floor(top)-2,
    width=Math.ceil(r.x+r.width)-x+2,height=Math.ceil(top+r.height)-y+2,
    left=Math.max(0,x),upper=Math.max(0,y),right=Math.min(imageWidth,x+width),bottom=Math.min(imageHeight,y+height);
  return {x,y,width,height,copy:{sx:left,sy:upper,w:right-left,h:bottom-upper,dx:left-x,dy:upper-y},source:{x:r.x-x,y:top-y}};
}
