import {component as comp} from './runtime.js';
import {loadGameFont,hasGameGlyphs,gameTextWidth,drawGameText} from './game-font.js';
import {rectBox,aspectBox,imageAspectBox,intersect,layoutProperty,linearGroupInput,linearGroupLayout} from './layout.js';
import {plainText,visibleLines,wrappingEnabled,textHeight} from './text-layout.js';
import {previewSpriteGeometryPlan,previewSpriteAspect} from './sprite-geometry.js';
import {identity4,multiply4,nodeMatrix4,outOfPlane,projectedQuad,flatQuad,quadBounds,drawProjected,validateProjection} from './projection.js';
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const number=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const white={r:1,g:1,b:1,a:1},zeroBorder={x:0,y:0,z:0,w:0};
export const color=(v=white)=>`rgba(${clamp(number(v.r,1),0,1)*255},${clamp(number(v.g,1),0,1)*255},${clamp(number(v.b,1),0,1)*255},${clamp(number(v.a,1),0,1)})`;
const makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w));c.height=Math.max(1,Math.ceil(h));return c;};
const imageCache=new Map();
export function loadImage(url){
  if(!imageCache.has(url)){
    if(imageCache.size>96)imageCache.delete(imageCache.keys().next().value);
    imageCache.set(url,new Promise((resolve,reject)=>{const im=new Image();im.crossOrigin='anonymous';im.onload=()=>resolve(im);im.onerror=()=>{imageCache.delete(url);reject(Error(`图片加载失败: ${url}`));};im.src=url;}));
  }
  return imageCache.get(url);
}
const fonts=new Map();
export async function loadFonts(pack,resolve){
  const gameFonts=new Map();let fontFamily='sans-serif';
  const names=new Set((pack.document.nodes||[]).map(n=>comp(n,'TextMeshProUGUI')?.m_fontAsset?.name).filter(n=>n?.includes('VibeMO')));
  await Promise.all([...names].map(async name=>gameFonts.set(name,await loadGameFont(loadImage,resolve(pack.resources.fontMetricsByAsset?.[name]||pack.resources.fontMetrics||'fonts/vibemo.json'),resolve))));
  for(const [name,file] of Object.entries(pack.resources?.fonts||{})){
    if(!name.includes('FZLTH'))continue;
    const url=resolve(file);if(!fonts.has(url)){const family='OurnotesUI'+fonts.size;fonts.set(url,new FontFace(family,`url(${JSON.stringify(url)})`).load().then(f=>{document.fonts.add(f);return family;}).catch(error=>{fonts.delete(url);throw error;}));}
    fontFamily=await fonts.get(url);
  }
  return {gameFonts,fontFamily};
}
export function buildNodes(pack){
  const stack=[],nodes=(pack.document.nodes||[]).map((n,i)=>{
    const depth=n.path.split('/').length;
    while(stack.length&&stack.at(-1).depth>=depth)stack.pop();
    const row={...n,i,depth,parent:stack.at(-1)?.i??-1,children:[]};stack.push(row);return row;
  });
  for(const n of nodes)if(n.parent>=0)nodes[n.parent].children.push(n.i);
  return nodes;
}
function sliced(ctx,im,w,h,b=zeroBorder,ppu=1,fill=true){
  ppu=Math.max(.001,ppu);const left=b.x/ppu,right=b.z/ppu,top=b.w/ppu,bottom=b.y/ppu;
  const hs=Math.min(1,w/Math.max(.001,left+right)),vs=Math.min(1,h/Math.max(.001,top+bottom));
  const sx=[0,b.x,im.width-b.z,im.width],sy=[0,b.w,im.height-b.y,im.height];
  const dx=[0,left*hs,w-right*hs,w],dy=[0,top*vs,h-bottom*vs,h];
  for(let y=0;y<3;y++)for(let x=0;x<3;x++){
    if(!fill&&x===1&&y===1)continue;
    const dw=dx[x+1]-dx[x],dh=dy[y+1]-dy[y];if(dw<=0||dh<=0)continue;
    // Unity permits a zero-width middle UV strip. Sample the boundary texel.
    const sw=Math.max(1,sx[x+1]-sx[x]),sh=Math.max(1,sy[y+1]-sy[y]);
    ctx.drawImage(im,Math.min(sx[x],im.width-sw),Math.min(sy[y],im.height-sh),sw,sh,dx[x],dy[y],dw,dh);
  }
}
function gradientAt(g,t){
  const sample=(prefix,count,getter)=>{
    const keys=Array.from({length:count},(_,i)=>({t:g[prefix+i]/65535,v:getter(g['key'+i])})).sort((a,b)=>a.t-b.t);
    if(!keys.length)return null;
    const end=keys.findIndex(k=>k.t>=t);if(end<0)return keys.at(-1).v;if(end===0)return keys[0].v;
    const a=keys[end-1],b=keys[end];if(g.m_Mode===1)return a.v;
    const f=(t-a.t)/(b.t-a.t||1);return a.v.map((v,i)=>v+(b.v[i]-v)*f);
  };
  return [...(sample('ctime',g.m_NumColorKeys,k=>[k.r,k.g,k.b])||[1,1,1]),(sample('atime',g.m_NumAlphaKeys,k=>[k.a])||[1])[0]];
}
function tint(ctx,w,h,tintColor,gradient){
  const c=tintColor||white,g=gradient?._gradient;
  if(!g&&c.r===1&&c.g===1&&c.b===1&&c.a===1)return;
  const pixels=ctx.getImageData(0,0,w,h),rad=(gradient?._angleDeg||0)*Math.PI/180,vx=Math.cos(rad),vy=-Math.sin(rad);
  const length=Math.abs(vx)*w+Math.abs(vy)*h;
  const lut=g?Array.from({length:257},(_,i)=>gradientAt(g,i/256)):null;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4;if(!pixels.data[i+3])continue;
    const f=lut?lut[Math.round(clamp(.5+((x-w/2)*vx+(y-h/2)*vy)/(length||1),0,1)*256)]:[1,1,1,1];
    pixels.data[i]*=number(c.r,1)*f[0];pixels.data[i+1]*=number(c.g,1)*f[1];pixels.data[i+2]*=number(c.b,1)*f[2];pixels.data[i+3]*=number(c.a,1)*f[3];
  }
  ctx.putImageData(pixels,0,0);
}
function fillPath(ctx,w,h,im){
  const a=clamp(im.m_FillAmount??1,0,1),method=im.m_FillMethod,origin=im.m_FillOrigin||0;
  ctx.beginPath();if(im.m_Type!==3||a>=1){ctx.rect(0,0,w,h);return;}
  if(a<=0){ctx.rect(0,0,0,0);return;}
  if(method===0){ctx.rect(origin?w*(1-a):0,0,w*a,h);return;}
  if(method===1){ctx.rect(0,origin?0:h*(1-a),w,h*a);return;}
  const clockwise=!!im.m_FillClockwise;
  let center,start,sweep;
  if(method===4){center=[w/2,h/2];start=[Math.PI/2,Math.PI,Math.PI*1.5,0][origin];sweep=Math.PI*2;}
  else if(method===3){center=[[w/2,h],[0,h/2],[w/2,0],[w,h/2]][origin];start=[Math.PI,Math.PI*1.5,0,Math.PI/2][origin];sweep=Math.PI;}
  else {center=[[0,h],[0,0],[w,0],[w,h]][origin];start=[Math.PI*1.5,0,Math.PI/2,Math.PI][origin];sweep=Math.PI/2;}
  if(!clockwise)start+=sweep;
  ctx.moveTo(...center);ctx.arc(...center,Math.hypot(w,h)*2,start,start+(clockwise?1:-1)*sweep*a,!clockwise);ctx.closePath();
}

export class Renderer {
  constructor(pack,options={}){
    this.pack=pack;this.options=options;this.nodes=buildNodes(pack);this.sprites=new Map();this.preferredCache=new Map();this.images=new Map();this.fontFamily='sans-serif';this.gameFonts=new Map();
    this.projection=options.projection?validateProjection(options.projection):null;this.regions=Object.create(null);
    this.metrics={drawn:0,hidden:0,transparent:0,unboundImages:0,particles:0};
    this.measure=makeCanvas(1,1).getContext('2d');
  }
  url(file){if(!file)throw Error('UI resource path missing');return new URL(file,this.options.assetBase||document.baseURI).href;}
  async sprite(ref){
    if(this.sprites.has(ref))return this.sprites.get(ref);
    const s=this.pack.resources.sprites[ref];if(!s)throw Error(`缺失 Sprite: ${ref}`);
    const file=this.pack.resources.textures[s.textureRef];if(!file)throw Error(`缺失贴图: ${s.textureRef}`);
    const im=await loadImage(this.url(file)),c=makeCanvas(s.rect.width,s.rect.height),ctx=c.getContext('2d'),r=s.textureRect,o=s.textureRectOffset;
    if(r.width>0&&r.height>0)ctx.drawImage(im,r.x,im.height-r.y-r.height,r.width,r.height,o.x,c.height-o.y-r.height,r.width,r.height);
    const result={canvas:c,meta:s};this.sprites.set(ref,result);return result;
  }
  children(n){return n.children.map(i=>this.nodes[i]).filter(c=>c.active&&!comp(c,'LayoutElement')?.m_IgnoreLayout);}
  layoutInput(n){
    if(this.preferredCache.has(n.i))return this.preferredCache.get(n.i);
    const elements=[[],[]],el=comp(n,'LayoutElement'),text=comp(n,'TextMeshProUGUI'),image=comp(n,'Image');
    const add=(min,preferred,flexible,priority=0)=>[0,1].forEach(axis=>elements[axis].push({priority,min:min[axis],preferred:preferred[axis],flexible:flexible[axis]}));
    if(text&&text.m_Enabled!==0){
      const fs=text.m_fontSize||24;this.measure.font=`${text.m_fontStyle&1?'bold ':''}${fs}px ${this.fontFamily},sans-serif`;
      const lines=visibleLines(plainText(text.m_text).split('\n')),margin=text.m_margin||zeroBorder,gameFont=this.gameFonts.get(text.m_fontAsset?.name);
      add([0,0],[Math.max(...lines.map(s=>hasGameGlyphs(s,text.m_fontAsset,gameFont)?gameTextWidth(s,fs,gameFont):this.measure.measureText(s).width),0)+Math.max(0,margin.x)+Math.max(0,margin.z),textHeight(lines,fs*1.16)+Math.max(0,margin.y)+Math.max(0,margin.w)],[-1,-1]);
    }
    if(image&&image.m_Enabled!==0){
      const sprite=image._previewSource&&image._previewSpriteGeometry||this.pack.resources?.sprites?.[image.m_Sprite?.spriteRef],border=sprite?.border||zeroBorder,ppu=(sprite?.pixelsPerUnit||100)/100*(image.m_PixelsPerUnitMultiplier||1),sliced=[1,2].includes(image.m_Type);
      add([0,0],sprite?[(sliced?border.x+border.z:sprite.rect.width)/ppu,(sliced?border.y+border.w:sprite.rect.height)/ppu]:[0,0],[-1,-1]);
    }
    const g=comp(n,'HorizontalLayoutGroup')||comp(n,'VerticalLayoutGroup')||comp(n,'RectFitVerticalLayoutGroup');
    if(g&&g.m_Enabled!==0){const value=linearGroupInput(g,this.layoutChildren(n));add(value.min,value.preferred,value.flexible);}
    if(el&&el.m_Enabled!==0)add([el.m_MinWidth,el.m_MinHeight],[el.m_PreferredWidth,el.m_PreferredHeight],[el.m_FlexibleWidth,el.m_FlexibleHeight],el.m_LayoutPriority??1);
    const min=elements.map(e=>layoutProperty(e,'min')),result={min,preferred:elements.map((e,axis)=>Math.max(min[axis],layoutProperty(e,'preferred'))),flexible:elements.map(e=>layoutProperty(e,'flexible'))};
    this.preferredCache.set(n.i,result);return result;
  }
  preferred(n){return this.layoutInput(n).preferred;}
  layoutChildren(n){return this.children(n).map(c=>({...this.layoutInput(c),i:c.i,size:[c.rect?.m_SizeDelta?.x||0,c.rect?.m_SizeDelta?.y||0],scale:[c.localScale?.x??1,c.localScale?.y??1],pivot:c.rect?.m_Pivot}));}
  layout(n,pw,ph,forced){
    if(forced)return forced;
    const nativeCanvas=comp(n,'Canvas');
    if(nativeCanvas&&nativeCanvas.m_RenderMode!==2)return {x:0,y:0,w:pw,h:ph,pivot:{x:0,y:1}};
    const r=n.rect||{},min=r.m_AnchorMin||{x:.5,y:.5},max=r.m_AnchorMax||min,pos=r.m_AnchoredPosition||{x:0,y:0},sz=r.m_SizeDelta||{x:0,y:0},pivot=r.m_Pivot||{x:.5,y:.5};
    let w=pw*(max.x-min.x)+sz.x,h=ph*(max.y-min.y)+sz.y;
    const fit=comp(n,'ContentSizeFitter');if(fit&&fit.m_Enabled!==0){const input=this.layoutInput(n);if(fit.m_HorizontalFit)w=(fit.m_HorizontalFit===1?input.min:input.preferred)[0];if(fit.m_VerticalFit)h=(fit.m_VerticalFit===1?input.min:input.preferred)[1];}
    const ar=comp(n,'AspectRatioFitter');let aspect=ar?.m_AspectRatio||1;
    const bound=n.children.map(i=>comp(this.nodes[i],'Image')).find(im=>im?._previewSource);
    if(bound&&this.images.has(bound._previewSource)){const im=this.images.get(bound._previewSource);aspect=previewSpriteAspect(bound._previewSpriteGeometry,im);}
    if(ar?.m_Enabled!==0){if(ar?.m_AspectMode===1)h=w/aspect;if(ar?.m_AspectMode===2)w=h*aspect;}
    if(ar&&ar.m_Enabled!==0&&[3,4].includes(ar.m_AspectMode))return aspectBox(pw,ph,aspect,ar.m_AspectMode,pivot);
    return rectBox(r,pw,ph,number(w),number(h));
  }
  childLayout(n,w,h){
    const result=new Map(),row=comp(n,'HorizontalLayoutGroup'),col=comp(n,'VerticalLayoutGroup')||comp(n,'RectFitVerticalLayoutGroup'),grid=comp(n,'GridLayoutGroup'),g=row||col||grid;
    if(!g||g.m_Enabled===0)return result;
    const p=g.m_Padding||{},left=p.m_Left||0,top=p.m_Top||0,aw=Math.max(0,w-left-(p.m_Right||0)),ah=Math.max(0,h-top-(p.m_Bottom||0));
    const children=this.children(n),align=g.m_ChildAlignment||0,ax=(align%3)/2,ay=Math.floor(align/3)/2;
    if(grid){
      const cell=grid.m_CellSize,space=grid.m_Spacing,vertical=grid.m_StartAxis===1;
      let cols=grid.m_Constraint===1?Math.max(1,grid.m_ConstraintCount):Math.max(1,Math.floor((aw+space.x)/(cell.x+space.x)));
      let rows=grid.m_Constraint===2?Math.max(1,grid.m_ConstraintCount):Math.ceil(children.length/cols);
      if(grid.m_Constraint===2)cols=Math.ceil(children.length/rows);
      if(grid.m_Constraint===0&&vertical){rows=Math.max(1,Math.floor((ah+space.y)/(cell.y+space.y)));cols=Math.ceil(children.length/rows);}
      const usedCols=Math.min(cols,children.length),usedRows=Math.min(rows,children.length),tw=usedCols*cell.x+Math.max(0,usedCols-1)*space.x,th=usedRows*cell.y+Math.max(0,usedRows-1)*space.y;
      children.forEach((c,i)=>{let x=vertical?Math.floor(i/rows):i%cols,y=vertical?i%rows:Math.floor(i/cols);if(grid.m_StartCorner%2)x=usedCols-1-x;if(grid.m_StartCorner>=2)y=usedRows-1-y;result.set(c.i,{x:left+(aw-tw)*ax+x*(cell.x+space.x),y:top+(ah-th)*ay+y*(cell.y+space.y),w:cell.x,h:cell.y,pivot:c.rect?.m_Pivot});});return result;
    }
    return linearGroupLayout(g,this.layoutChildren(n),w,h);
  }
  async imageLayer(n,im,w,h){
    if(w<=0||h<=0)return null;
    let sp;
    if(im._previewSource){
      const source=this.images.get(im._previewSource)||await loadImage(im._previewSource);
      if(im._previewSpriteGeometry){
        const plan=previewSpriteGeometryPlan(im._previewSpriteGeometry,source.width,source.height),canvas=makeCanvas(plan.canvas.width,plan.canvas.height),ctx=canvas.getContext('2d'),s=plan.source,d=plan.destination;
        ctx.drawImage(source,s.x,s.y,s.width,s.height,d.x,d.y,d.width,d.height);
        sp={canvas,meta:im._previewSpriteGeometry};
      }else sp={canvas:source,meta:{border:zeroBorder,pixelsPerUnit:100}};
    }
    else if(im.m_Sprite?.spriteRef)sp=await this.sprite(im.m_Sprite.spriteRef);
    const scale=Math.min(1,4096/w,4096/h,Math.sqrt(8388608/(w*h))),layer=makeCanvas(w*scale,h*scale),ctx=layer.getContext('2d');
    ctx.scale(scale,scale);ctx.save();const flip=comp(n,'UIFlipImage');
    if(flip?.m_Enabled!==0&&flip){ctx.translate(flip._isFlipX?w:0,flip._isFlipY?h:0);ctx.scale(flip._isFlipX?-1:1,flip._isFlipY?-1:1);}
    if(!sp){ctx.fillStyle='white';ctx.fillRect(0,0,w,h);this.metrics.unboundImages++;}
    else if(im.m_Type===1)sliced(ctx,sp.canvas,w,h,sp.meta.border,(sp.meta.pixelsPerUnit||100)/100*(im.m_PixelsPerUnitMultiplier||1),im.m_FillCenter!==0);
    else {
      const drawing=im.m_PreserveAspect?imageAspectBox(w,h,sp.canvas.width,sp.canvas.height,n.rect?.m_Pivot):{x:0,y:0,w,h};
      fillPath(ctx,w,h,im);ctx.clip();
      if(im.m_Type===2){const ppu=(sp.meta.pixelsPerUnit||100)/100*(im.m_PixelsPerUnitMultiplier||1);ctx.scale(1/ppu,1/ppu);ctx.fillStyle=ctx.createPattern(sp.canvas,'repeat');ctx.fillRect(0,0,w*ppu,h*ppu);}
      else ctx.drawImage(sp.canvas,drawing.x,drawing.y,drawing.w,drawing.h);
    }
    ctx.restore();ctx.setTransform(1,0,0,1,0,0);tint(ctx,layer.width,layer.height,im.m_Color,comp(n,'UIGradientImage'));return layer;
  }
  drawText(n,ctx,w,h){
    const t=comp(n,'TextMeshProUGUI');if(!t||t.m_Enabled===0)return;
    const plain=plainText(t.m_text),margin=t.m_margin||zeroBorder,available=Math.max(1,w-margin.x-margin.z);
    let fs=t.m_fontSize||24;
    const font=()=>`${t.m_fontStyle&1?'bold ':''}${t.m_fontStyle&2?'italic ':''}${fs}px ${this.fontFamily},sans-serif`;
    const gameFont=this.gameFonts.get(t.m_fontAsset?.name),native=hasGameGlyphs(plain,t.m_fontAsset,gameFont),width=s=>native?gameTextWidth(s,fs,gameFont):ctx.measureText(s).width;
    const wrap=()=>{ctx.font=font();const result=[];for(const line of plain.split('\n')){if(!wrappingEnabled(t)){result.push(line);continue;}let current='';for(const ch of line){if(current&&width(current+ch)>available){result.push(current);current=ch;}else current+=ch;}result.push(current);}return visibleLines(result);};
    let lines=wrap();if(t.m_enableAutoSizing){const min=t.m_fontSizeMin||fs;fs=Math.min(t.m_fontSizeMax||fs,fs);lines=wrap();while(fs>min&&(textHeight(lines,fs*1.16)>h-margin.y-margin.w||lines.some(l=>width(l)>available))){fs=Math.max(min,fs-1);lines=wrap();}}
    const align=t.m_HorizontalAlignment||1,vertical=t.m_VerticalAlignment||512,lineHeight=fs*1.16+(t.m_lineSpacing||0),th=lines.length*lineHeight;
    const tx=align===2?margin.x+available/2:align===4?w-margin.z:margin.x;
    let ty=vertical===256?margin.y+lineHeight/2:vertical===1024?h-margin.w-th+lineHeight/2:margin.y+(h-margin.y-margin.w-th)/2+lineHeight/2;
    ctx.save();if([1,2,3].includes(t.m_overflowMode)){ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();}
    ctx.font=font();ctx.textAlign=align===2?'center':align===4?'right':'left';ctx.textBaseline='middle';ctx.fillStyle=color(t.m_fontColor||t.m_Color);
    const shadow=comp(n,'Shadow'),outline=comp(n,'Outline');if(shadow){ctx.shadowColor=color(shadow.m_EffectColor);ctx.shadowOffsetX=shadow.m_EffectDistance?.x||0;ctx.shadowOffsetY=-(shadow.m_EffectDistance?.y||0);}
    lines.forEach((line,i)=>{if(native){drawGameText(ctx,line,tx,ty+i*lineHeight,fs,t.m_fontColor||t.m_Color||white,gameFont);return;}if(outline){ctx.strokeStyle=color(outline.m_EffectColor);ctx.lineWidth=Math.max(Math.abs(outline.m_EffectDistance?.x||1),Math.abs(outline.m_EffectDistance?.y||1))*2;ctx.strokeText(line,tx,ty+i*lineHeight);}ctx.fillText(line,tx,ty+i*lineHeight);});ctx.restore();if(plain)this.metrics.drawn++;
  }
  async projectedSubtree(n,ctx,box,world){
    const check=node=>{
      if(this.options.hidden?.has(node.i)||!node.active&&!this.options.showHidden)return;
      if(outOfPlane(node))throw Error('UI projection: nested nonplanar subtree unsupported: '+node.path);
      for(const i of node.children)check(this.nodes[i]);
    };
    for(const i of n.children)check(this.nodes[i]);
    // Compose the original planar subtree first: frame/foreground/masks retain
    // their original painter order and transparent overflow remains in the quad.
    const flat=new Renderer(this.pack,{...this.options,projection:undefined,framing:'content',ignoreRootRotation:true});
    flat.sprites=this.sprites;flat.images=this.images;flat.gameFonts=this.gameFonts;flat.fontFamily=this.fontFamily;
    const result=await flat.render(n.i,[box.w,box.h],true),b=result.bounds;
    const rect={x:b.minX-24,y:b.minY-24,w:result.canvas.width/result.scale,h:result.canvas.height/result.scale};
    const quad=projectedQuad(world,rect,this.projection);
    ctx.save();try{ctx.setTransform(this.baseTransform);drawProjected(ctx,result.canvas,quad);}finally{ctx.restore();}
    for(const [key,value] of Object.entries(flat.metrics))this.metrics[key]+=value;
  }
  async drawNode(n,ctx,pw,ph,forced,isRoot=false,parentWorld=identity4(),insideMask=false){
    if(this.options.hidden?.has(n.i))return;
    if(!isRoot&&!n.active&&!this.options.showHidden){this.metrics.hidden++;return;}
    const b=isRoot?{x:0,y:0,w:pw,h:ph,pivot:n.rect?.m_Pivot||{x:.5,y:.5}}:this.layout(n,pw,ph,forced),{w,h}=b,pivot=b.pivot||{x:.5,y:.5};
    const nativeCanvas=comp(n,'Canvas'),world=multiply4(parentWorld,nodeMatrix4(b,n,isRoot||nativeCanvas&&nativeCanvas.m_RenderMode!==2));
    if(this.projection&&!isRoot&&outOfPlane(n)){
      if(insideMask)throw Error('UI projection: projected subtree inside a mask unsupported: '+n.path);
      await this.projectedSubtree(n,ctx,b,world);return;
    }
    ctx.save();try{
      ctx.translate(b.x+w*pivot.x,b.y+h*(1-pivot.y));const q=n.localRotation||{z:0,w:1};ctx.rotate(isRoot&&this.options.ignoreRootRotation?0:n.euler?-n.euler.z*Math.PI/180:-2*Math.atan2(q.z,q.w));
      const s=isRoot||(nativeCanvas&&nativeCanvas.m_RenderMode!==2)?{x:1,y:1}:(n.localScale||{x:1,y:1});ctx.scale(number(s.x,1),number(s.y,1));ctx.translate(-w*pivot.x,-h*(1-pivot.y));
      const cg=comp(n,'CanvasGroup');if(cg&&!this.options.showHidden)ctx.globalAlpha*=clamp(number(cg.m_Alpha,1),0,1);
      if(ctx.globalAlpha<.001){this.metrics.transparent++;return;}
      const im=comp(n,'Image'),mask=comp(n,'Mask'),hasMask=mask&&mask.m_Enabled!==0;
      const layer=im&&im.m_Enabled!==0?await this.imageLayer(n,im,w,h):null;
      if(layer&&(!hasMask||mask.m_ShowMaskGraphic)){ctx.drawImage(layer,0,0,w,h);this.metrics.drawn++;}
      const raw=comp(n,'RawImage');if(raw?.m_Enabled!==0&&raw&&w>0&&h>0){
        const file=this.pack.resources.textures[raw.m_Texture?.textureRef];if(file){const image=await loadImage(this.url(file)),uv=raw.m_UVRect||{x:0,y:0,width:1,height:1};ctx.save();ctx.globalAlpha*=raw.m_Color?.a??1;ctx.drawImage(image,uv.x*image.width,(1-uv.y-uv.height)*image.height,uv.width*image.width,uv.height*image.height,0,0,w,h);ctx.restore();this.metrics.drawn++;}else this.metrics.unboundImages++;
      }
      this.drawText(n,ctx,w,h);if(comp(n,'ParticleSystem'))this.metrics.particles++;
      if(this.options.bounds){ctx.strokeStyle='#cf4d90';ctx.lineWidth=.6;ctx.strokeRect(0,0,w,h);}
      const layouts=this.childLayout(n,w,h);
      if(hasMask&&layer&&w>0&&h>0){
        // Sprite-alpha masks need an isolated subtree, including when its graphic is hidden.
        const maskScale=Math.min(1,4096/w,4096/h),sub=makeCanvas(w*maskScale,h*maskScale),sx=sub.getContext('2d');sx.scale(maskScale,maskScale);
        for(const i of n.children)await this.drawNode(this.nodes[i],sx,w,h,layouts.get(i),false,world,true);
        sx.globalCompositeOperation='destination-in';sx.drawImage(layer,0,0,w,h);ctx.drawImage(sub,0,0,w,h);
      }else{
        if(hasMask||comp(n,'RectMask2D')||comp(n,'SoftMask')){ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();}
        for(const i of n.children)await this.drawNode(this.nodes[i],ctx,w,h,layouts.get(i),false,world,insideMask||!!(hasMask||comp(n,'RectMask2D')||comp(n,'SoftMask')));
      }
    }catch(error){if(!error.nodePath)error.nodePath=n.path;throw error;}finally{ctx.restore();}
  }
  visibleBounds(root,w,h){
    const rootBounds={minX:0,minY:0,maxX:w,maxY:h};let bounds=this.options.framing==='content'?null:rootBounds;
    const visit=(n,pw,ph,matrix,forced,clip,alpha,isRoot=false)=>{
      if(this.options.hidden?.has(n.i)||!isRoot&&!n.active&&!this.options.showHidden)return;
      const box=isRoot?{x:0,y:0,w:pw,h:ph,pivot:n.rect?.m_Pivot||{x:.5,y:.5}}:this.layout(n,pw,ph,forced),canvas=comp(n,'Canvas'),scale=isRoot||canvas&&canvas.m_RenderMode!==2?{x:1,y:1}:n.localScale||{x:1,y:1},q=n.localRotation||{z:0,w:1};
      const local=this.projection?nodeMatrix4(box,n,isRoot||canvas&&canvas.m_RenderMode!==2):nodeMatrix4(box,{localScale:scale,euler:{x:0,y:0,z:n.euler?.z??2*Math.atan2(q.z,q.w)*180/Math.PI}},isRoot),m=multiply4(matrix,local),group=comp(n,'CanvasGroup');
      if(group&&!this.options.showHidden)alpha*=clamp(number(group.m_Alpha,1),0,1);if(alpha<.001)return;
      const im=comp(n,'Image'),raw=comp(n,'RawImage'),text=comp(n,'TextMeshProUGUI'),mask=comp(n,'Mask'),masking=mask&&mask.m_Enabled!==0;
      const graphic=this.options.bounds||im&&im.m_Enabled!==0&&(!masking||mask.m_ShowMaskGraphic)&&number(im.m_Color?.a,1)>0||raw&&raw.m_Enabled!==0&&raw.m_Texture||text&&text.m_Enabled!==0&&text.m_text;
      const quad=this.projection?projectedQuad(m,{x:0,y:0,w:box.w,h:box.h},this.projection):flatQuad(m,{x:0,y:0,w:box.w,h:box.h}),world=quadBounds(quad);
      this.regions[n.nodeId||n.path]=quad.map(({x,y})=>({x,y}));
      if(graphic&&box.w>0&&box.h>0){const extent=intersect(world,clip);if(extent)bounds=bounds?{minX:Math.min(bounds.minX,extent.minX),minY:Math.min(bounds.minY,extent.minY),maxX:Math.max(bounds.maxX,extent.maxX),maxY:Math.max(bounds.maxY,extent.maxY)}:extent;}
      if(masking||comp(n,'RectMask2D')||comp(n,'SoftMask')){clip=intersect(world,clip);if(!clip)return;}
      const layouts=this.childLayout(n,box.w,box.h);for(const i of n.children)visit(this.nodes[i],box.w,box.h,m,layouts.get(i),clip,alpha);
    };
    visit(root,w,h,identity4(),null,null,1,true);
    return comp(root,'Canvas')&&this.options.framing!=='content'?rootBounds:bounds||rootBounds;
  }
  async render(rootIndex=0,rootSize=null,resourcesReady=false){
    if(!resourcesReady){Object.assign(this,await loadFonts(this.pack,file=>this.url(file)));await Promise.all(this.nodes.flatMap(n=>n.components.filter(c=>c._previewSource).map(async c=>this.images.set(c._previewSource,await loadImage(this.url(c._previewSource))))));}
    const root=this.nodes[rootIndex];if(!root)throw Error('预制体没有根节点');
    const vp=this.options.viewport||[1920,1080],natural=this.layout(root,...vp),w=rootSize?.[0]??(natural.w>0?natural.w:vp[0]),h=rootSize?.[1]??(natural.h>0?natural.h:vp[1]);
    const bounds=this.visibleBounds(root,w,h),width=Math.ceil(bounds.maxX-bounds.minX)+48,height=Math.ceil(bounds.maxY-bounds.minY)+48,scale=Math.min(1,4096/width,4096/height),canvas=makeCanvas(width*scale,height*scale),ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.translate(24-bounds.minX,24-bounds.minY);
    this.baseTransform=this.projection?ctx.getTransform():null;await this.drawNode(root,ctx,w,h,null,true);return {canvas,width:w,height:h,bounds,metrics:this.metrics,regions:this.regions,scale,padding:24};
  }
  async renderAsset(){
    const doc=this.pack.document,refs=doc.sprites?(Array.isArray(doc.sprites)?doc.sprites:Object.values(doc.sprites)):doc.spriteRef?[doc]:[];
    const sprites=await Promise.all(refs.filter(x=>x?.spriteRef).map(x=>this.sprite(x.spriteRef)));
    const canvas=makeCanvas(1200,Math.max(250,Math.ceil(sprites.length/8)*150)),ctx=canvas.getContext('2d');
    sprites.forEach((s,i)=>{const f=Math.min(125/s.canvas.width,115/s.canvas.height,1);ctx.drawImage(s.canvas,i%8*150+12,Math.floor(i/8)*150+8,s.canvas.width*f,s.canvas.height*f);ctx.fillStyle='#463c56';ctx.font='10px sans-serif';ctx.fillText(s.meta.name.slice(0,23),i%8*150+8,Math.floor(i/8)*150+140);});
    if(!sprites.length&&doc.textureRef){const im=await loadImage(this.url(this.pack.resources.textures[doc.textureRef]));canvas.width=im.width;canvas.height=im.height;ctx.drawImage(im,0,0);}
    return {canvas,sprites:sprites.length};
  }
}
