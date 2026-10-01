// ENGINE: reference-resolution Screen Space - Camera coordinates. Scene sizing
// and custom camera matrices remain outside this optional static preview path.
export const identity4=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function multiply4(a,b){
  const out=Array(16).fill(0);
  for(let r=0;r<4;r++)for(let c=0;c<4;c++)for(let k=0;k<4;k++)out[r*4+c]+=a[r*4+k]*b[k*4+c];
  return out;
}
const finite=(v,label)=>{if(typeof v!=='number'||!Number.isFinite(v))throw Error('UI projection: invalid '+label);return v;};

/** Read the actual serialized Camera/Canvas; unsupported camera modes fail explicitly. */
export function cameraProjection(camera,canvas,referenceViewport){
  if(camera?.orthographic!==false||canvas?.m_RenderMode!==1)throw Error('UI projection requires a perspective Screen Space - Camera Canvas');
  const lens=camera.m_LensShift,view=camera.m_NormalizedViewPortRect;
  if(lens&&(lens.x!==0||lens.y!==0)||view&&(view.x!==0||view.y!==0||view.width!==1||view.height!==1))throw Error('UI projection: shifted lens/partial camera viewport unsupported');
  return validateProjection({fieldOfView:camera['field of view'],referenceViewport,canvasPlaneDistance:canvas.m_PlaneDistance,nearClipPlane:camera['near clip plane']});
}
export function validateProjection(value){
  const fov=finite(value?.fieldOfView,'field of view'),distance=finite(value?.canvasPlaneDistance,'Canvas plane distance');
  if(fov<=0||fov>=180||distance<=0)throw Error('UI projection: invalid camera range');
  if(!Array.isArray(value.referenceViewport)||value.referenceViewport.length!==2)throw Error('UI projection: reference viewport required');
  const viewport=value.referenceViewport.map((v,i)=>finite(v,'viewport '+i));
  if(viewport.some(v=>v<=0))throw Error('UI projection: nonpositive viewport');
  const near=value.nearClipPlane===undefined?0:finite(value.nearClipPlane,'near plane');
  if(near<0||near>=distance)throw Error('UI projection: invalid near plane');
  return {fieldOfView:fov,referenceViewport:viewport,canvasPlaneDistance:distance,nearClipPlane:near};
}

/** Quaternion is Unity's x/right, y/up, z/forward basis; Canvas y points down. */
export function nodeMatrix4(box,node,isRoot=false){
  if(isRoot)return identity4();
  const q=node.localRotation||{x:0,y:0,z:0,w:1};
  let {x=0,y=0,z=0,w=1}=q;
  if(node.euler){const e=node.euler,rx=finite(e.x??0,'Euler x')*Math.PI/360,ry=finite(e.y??0,'Euler y')*Math.PI/360,rz=finite(e.z??0,'Euler z')*Math.PI/360;
    const sx=Math.sin(rx),cx=Math.cos(rx),sy=Math.sin(ry),cy=Math.cos(ry),sz=Math.sin(rz),cz=Math.cos(rz);
    // Unity's documented Z-X-Y Euler sequence (Ry * Rx * Rz).
    x=cy*sx*cz+sy*cx*sz;y=sy*cx*cz-cy*sx*sz;z=cy*cx*sz-sy*sx*cz;w=cy*cx*cz+sy*sx*sz;
  }
  const norm=Math.hypot(x,y,z,w);if(!Number.isFinite(norm)||norm===0)throw Error('UI projection: invalid quaternion');
  x/=norm;y/=norm;z/=norm;w/=norm;
  const s=node.localScale||{x:1,y:1,z:1},sx=finite(s.x??1,'scale x'),sy=finite(s.y??1,'scale y'),sz=finite(s.z??1,'scale z');
  const rotation=[1-2*(y*y+z*z),-2*(x*y-z*w),2*(x*z+y*w),0,
    -2*(x*y+z*w),1-2*(x*x+z*z),-2*(y*z-x*w),0,
    2*(x*z-y*w),-2*(y*z+x*w),1-2*(x*x+y*y),0,0,0,0,1];
  for(let r=0;r<3;r++){rotation[r*4]*=sx;rotation[r*4+1]*=sy;rotation[r*4+2]*=sz;}
  const pivot=box.pivot||{x:.5,y:.5},px=box.w*pivot.x,py=box.h*(1-pivot.y);
  rotation[3]=box.x+px-rotation[0]*px-rotation[1]*py;
  rotation[7]=box.y+py-rotation[4]*px-rotation[5]*py;
  rotation[11]=finite(node.localPosition?.z??0,'local z')-rotation[8]*px-rotation[9]*py;
  return rotation;
}
export function outOfPlane(node){
  // Serialized identity transforms contain float roundoff (e.g. z=3.8e-6).
  const nonzero=v=>Math.abs(v||0)>1e-5;
  return nonzero(node.localPosition?.z)||nonzero(node.euler?.x)||nonzero(node.euler?.y)||!node.euler&&(nonzero(node.localRotation?.x)||nonzero(node.localRotation?.y));
}
export function flatQuad(matrix,rect){
  return [[rect.x,rect.y],[rect.x+rect.w,rect.y],[rect.x+rect.w,rect.y+rect.h],[rect.x,rect.y+rect.h]].map(([x,y])=>({x:matrix[0]*x+matrix[1]*y+matrix[3],y:matrix[4]*x+matrix[5]*y+matrix[7]}));
}
export function projectedQuad(matrix,rect,projection){
  const [vw,vh]=projection.referenceViewport,d=vh/(2*Math.tan(projection.fieldOfView*Math.PI/360)),cx=vw/2,cy=vh/2;
  const near=d*projection.nearClipPlane/projection.canvasPlaneDistance;
  const point=(x,y)=>{
    const wx=matrix[0]*x+matrix[1]*y+matrix[3],wy=matrix[4]*x+matrix[5]*y+matrix[7],wz=matrix[8]*x+matrix[9]*y+matrix[11],weight=d+wz;
    if(weight<=near)throw Error('UI projection: content crosses the camera near plane');
    return {x:cx+(wx-cx)*d/weight,y:cy+(wy-cy)*d/weight,weight};
  };
  return [point(rect.x,rect.y),point(rect.x+rect.w,rect.y),point(rect.x+rect.w,rect.y+rect.h),point(rect.x,rect.y+rect.h)];
}
export function quadBounds(points){return {minX:Math.min(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxX:Math.max(...points.map(p=>p.x)),maxY:Math.max(...points.map(p=>p.y))};}
export function quadPoint(quad,u,v){
  const factors=[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v];let x=0,y=0,w=0;
  quad.forEach((p,i)=>{const k=factors[i]*p.weight;x+=p.x*k;y+=p.y*k;w+=k;});
  return {x:x/w,y:y/w};
}
function triangle(ctx,image,source,target){
  const [a,b,c]=source,[p,q,r]=target,den=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);
  if(Math.abs(den)<1e-9)return;
  const xx=((q.x-p.x)*(c.y-a.y)-(r.x-p.x)*(b.y-a.y))/den;
  const xy=((r.x-p.x)*(b.x-a.x)-(q.x-p.x)*(c.x-a.x))/den;
  const yx=((q.y-p.y)*(c.y-a.y)-(r.y-p.y)*(b.y-a.y))/den;
  const yy=((r.y-p.y)*(b.x-a.x)-(q.y-p.y)*(c.x-a.x))/den;
  ctx.save();try{ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.lineTo(r.x,r.y);ctx.closePath();ctx.clip();
    ctx.transform(xx,yx,xy,yy,p.x-xx*a.x-xy*a.y,p.y-yx*a.x-yy*a.y);ctx.drawImage(image,0,0);
  }finally{ctx.restore();}
}
/** Canvas 2D projective texture approximation; UV points use exact homogeneous interpolation. */
export function drawProjected(ctx,image,quad,divisions=12){
  for(let y=0;y<divisions;y++)for(let x=0;x<divisions;x++){
    const uv=[[x/divisions,y/divisions],[(x+1)/divisions,y/divisions],[(x+1)/divisions,(y+1)/divisions],[x/divisions,(y+1)/divisions]];
    const s=uv.map(([u,v])=>({x:u*image.width,y:v*image.height})),t=uv.map(([u,v])=>quadPoint(quad,u,v));
    triangle(ctx,image,[s[0],s[1],s[2]],[t[0],t[1],t[2]]);triangle(ctx,image,[s[0],s[2],s[3]],[t[0],t[2],t[3]]);
  }
}
