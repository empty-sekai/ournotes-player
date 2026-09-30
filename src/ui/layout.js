// ENGINE: RectTransform sizes remain signed. A negative intermediate rect can
// have positive stretched children; clamping the parent changes their size.
export function rectBox(rect,pw,ph,width,height){
  const min=rect.m_AnchorMin||{x:.5,y:.5},max=rect.m_AnchorMax||min,pos=rect.m_AnchoredPosition||{x:0,y:0},size=rect.m_SizeDelta||{x:0,y:0},pivot=rect.m_Pivot||{x:.5,y:.5};
  const w=width??pw*(max.x-min.x)+size.x,h=height??ph*(max.y-min.y)+size.y;
  return {x:pw*(min.x+(max.x-min.x)*pivot.x)+pos.x-w*pivot.x,y:ph*(1-min.y-(max.y-min.y)*pivot.y)-pos.y-h*(1-pivot.y),w,h,pivot};
}
export function aspectBox(pw,ph,aspect,mode,pivot={x:.5,y:.5}){
  const w=(mode===3?Math.min:Math.max)(pw,ph*aspect),h=w/aspect;
  return {x:(pw-w)*pivot.x,y:(ph-h)*(1-pivot.y),w,h,pivot};
}
export function imageAspectBox(w,h,sw,sh,pivot={x:.5,y:.5}){
  const scale=Math.min(w/sw,h/sh),width=sw*scale,height=sh*scale;
  return {x:(w-width)*pivot.x,y:(h-height)*(1-pivot.y),w:width,h:height};
}
export const affine={
  mul(m,n){return [m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];},
  box(b,angle=0,scale={x:1,y:1}){
    const p=b.pivot||{x:.5,y:.5},px=b.w*p.x,py=b.h*(1-p.y),c=Math.cos(angle),s=Math.sin(angle),a=c*scale.x,v=s*scale.x,k=-s*scale.y,d=c*scale.y;
    return [a,v,k,d,b.x+px-a*px-k*py,b.y+py-v*px-d*py];
  },
  bounds(m,w,h){const points=[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);return {minX:Math.min(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxX:Math.max(...points.map(p=>p[0])),maxY:Math.max(...points.map(p=>p[1]))};}
};
export function intersect(a,b){if(!b)return a;const r={minX:Math.max(a.minX,b.minX),minY:Math.max(a.minY,b.minY),maxX:Math.min(a.maxX,b.maxX),maxY:Math.min(a.maxY,b.maxY)};return r.maxX>r.minX&&r.maxY>r.minY?r:null;}

// LayoutUtility: a negative property does not participate, highest priority
// wins and equal priorities take the larger value.
export function layoutProperty(elements,property,fallback=0){
  let value=fallback,priority=-Infinity;
  for(const element of elements){
    const v=element[property],p=element.priority??0;
    if(!Number.isFinite(v)||v<0||p<priority)continue;
    if(p>priority){value=v;priority=p;}else value=Math.max(value,v);
  }
  return value;
}
function groupSettings(group){
  const p=group.m_Padding||{},align=group.m_ChildAlignment||0;
  return {vertical:group.class!=='HorizontalLayoutGroup',spacing:group.m_Spacing||0,
    padding:[(p.m_Left||0)+(p.m_Right||0),(p.m_Top||0)+(p.m_Bottom||0)],start:[p.m_Left||0,p.m_Top||0],
    align:[align%3/2,Math.floor(align/3)/2],control:[!!group.m_ChildControlWidth,!!group.m_ChildControlHeight],
    expand:[!!group.m_ChildForceExpandWidth,!!group.m_ChildForceExpandHeight],scale:[!!group.m_ChildScaleWidth,!!group.m_ChildScaleHeight]};
}
function childSizes(child,axis,g){
  const controlled=g.control[axis],size=child.size[axis],scale=g.scale[axis]?child.scale?.[axis]??1:1;
  const min=controlled?child.min[axis]:size,preferred=controlled?child.preferred[axis]:size;
  // The Ghidra C omits this fmaxnm/fcsel branch; it is present at
  // 0xbd29fec..0xbd2a004 in the hash-checked native instructions.
  const flexible=Math.max(controlled?child.flexible[axis]:0,g.expand[axis]?1:0);
  return {min,preferred,flexible,scale};
}
function groupAxis(g,children,axis){
  const other=g.vertical!==(axis===1),pad=g.padding[axis];
  let min=pad,preferred=pad,flexible=0;
  for(const child of children){
    const s=childSizes(child,axis,g);
    if(other){min=Math.max(min,s.min*s.scale+pad);preferred=Math.max(preferred,s.preferred*s.scale+pad);flexible=Math.max(flexible,s.flexible*s.scale);}
    else {min+=s.min*s.scale+g.spacing;preferred+=s.preferred*s.scale+g.spacing;flexible+=s.flexible*s.scale;}
  }
  if(!other&&children.length){min-=g.spacing;preferred-=g.spacing;}
  return {min,preferred:Math.max(min,preferred),flexible};
}
export function linearGroupInput(group,children){
  const g=groupSettings(group),axes=[0,1].map(axis=>groupAxis(g,children,axis));
  return {min:axes.map(a=>a.min),preferred:axes.map(a=>a.preferred),flexible:axes.map(a=>a.flexible)};
}
// SetChildrenAlongAxis: cells may expand while an uncontrolled child keeps its
// serialized size. Positions include SetChildAlongAxisWithScale's pivot term.
export function linearGroupLayout(group,input,w,h){
  const g=groupSettings(group),children=group.m_ReverseArrangement?[...input].reverse():input,size=[w,h],result=new Map();
  for(const child of children)result.set(child.i,{x:0,y:0,w:child.size[0],h:child.size[1],pivot:child.pivot});
  for(const axis of [0,1]){
    const total=groupAxis(g,children,axis),other=g.vertical!==(axis===1),align=g.align[axis],start=required=>g.start[axis]+(size[axis]-g.padding[axis]-required)*align;
    const place=(child,pos,allocated,s)=>{
      const actual=g.control[axis]?allocated:child.size[axis],pivot=axis===0?child.pivot?.x??.5:1-(child.pivot?.y??.5),box=result.get(child.i);
      box[axis===0?'x':'y']=pos+actual*pivot*(s.scale-1);
      box[axis===0?'w':'h']=actual;
    };
    if(other){
      const inner=size[axis]-g.padding[axis];
      for(const child of children){const s=childSizes(child,axis,g),required=Math.max(s.min,Math.min(inner,s.flexible>0?size[axis]:s.preferred));place(child,start(required*s.scale)+(g.control[axis]?0:(required-child.size[axis])*align),required,s);}
    }else{
      const surplus=size[axis]-total.preferred,flex=surplus>0&&total.flexible>0?surplus/total.flexible:0,lerp=total.min===total.preferred?0:Math.max(0,Math.min(1,(size[axis]-total.min)/(total.preferred-total.min)));
      let cursor=surplus>0&&!total.flexible?start(total.preferred-g.padding[axis]):g.start[axis];
      for(const child of children){const s=childSizes(child,axis,g),allocated=s.min+(s.preferred-s.min)*lerp+s.flexible*flex;place(child,cursor+(g.control[axis]?0:(allocated-child.size[axis])*align),allocated,s);cursor+=allocated*s.scale+g.spacing;}
    }
  }
  return result;
}
