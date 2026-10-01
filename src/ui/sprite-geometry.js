// Sprite bitmaps exported from textureRect are trimmed, while Unity Image and
// UIAddressableImage use Sprite.rect. Preserve the original logical rectangle.
const finite=(value,label)=>{
  if(!Number.isFinite(value))throw Error(`Invalid preview Sprite ${label}`);
  return value;
};
export function previewSpriteGeometryPlan(geometry,imageWidth,imageHeight){
  const r=geometry?.rect,t=geometry?.textureRect,o=geometry?.textureRectOffset;
  if(!r||!t||!o)throw Error('Preview Sprite requires original rect, textureRect and textureRectOffset');
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
