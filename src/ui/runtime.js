// Serialized UI bindings. Edits apply only to the in-memory preview copy.
export const component=(n,name)=>n?.components?.find(c=>(c.class||c.type)===name);
export function nodeMap(pack){return new Map((pack.document.nodes||[]).map(n=>[n.path,n]));}
const referenceTables=new WeakMap();
export function nodeReferences(pack){
  if(referenceTables.has(pack))return referenceTables.get(pack);
  const nodes=pack.document.nodes||[],paths=new Map(),ids=new Map(),parents=[],ends=[],stack=[];
  nodes.forEach((n,i)=>{const depth=n.path.split('/').length;while(stack.length&&stack.at(-1).depth>=depth)ends[stack.pop().index]=i;parents[i]=stack.at(-1)?.index??-1;stack.push({depth,index:i});paths.set(n.path,[...(paths.get(n.path)||[]),i]);if(n.nodeId)ids.set(n.nodeId,i);});
  while(stack.length)ends[stack.pop().index]=nodes.length;
  const table={nodes,paths,ids,parents,ends};referenceTables.set(pack,table);return table;
}
export function referenceNode(pack,ref,origin=-1){
  const t=nodeReferences(pack);if(ref?.nodeId&&t.ids.has(ref.nodeId))return {node:t.nodes[t.ids.get(ref.nodeId)],index:t.ids.get(ref.nodeId)};
  const path=typeof ref==='string'?ref:ref?.gameObject||ref?.transform,matches=t.paths.get(path)||[];
  if(matches.length===1)return {node:t.nodes[matches[0]],index:matches[0]};
  for(let i=origin;i>=0;i=t.parents[i]){const scope=matches.filter(j=>j>=i&&j<t.ends[i]);if(scope.length===1)return {node:t.nodes[scope[0]],index:scope[0]};}
  return null;
}
export function resolveNodeIndex(pack,selector){
  const t=nodeReferences(pack);if(Number.isInteger(selector)&&t.nodes[selector])return selector;
  if(typeof selector==='string'){
    if(t.ids.has(selector))return t.ids.get(selector);
    const matches=t.paths.get(selector)||t.nodes.flatMap((n,i)=>n.name===selector?[i]:[]);
    if(matches.length===1)return matches[0];if(matches.length>1)throw Error('Ambiguous UI node: '+selector);
  }
  throw Error('UI node not found: '+selector);
}
export function catalogs(pack){
  const result=new Map();
  function walk(v){
    if(Array.isArray(v))v.forEach(walk);
    else if(v&&typeof v==='object'){
      if(v.asset&&Object.keys(v).length>2)result.set(`${v.asset}:${v.name}`,v);
      Object.values(v).forEach(walk);
    }
  }
  walk(pack.document);return result;
}
export function applyBindings(pack){
  const assets=catalogs(pack);let origin=-1;const target=(ref,fallback)=>referenceNode(pack,ref,origin)?.node||fallback;
  for(const n of pack.document.nodes||[]){origin++;for(const c of n.components){
    if(c.m_Enabled===0)continue;
    const ref=c._spriteCatalog||c._gradientCatalog;
    const cat=ref&&(assets.get(`${ref.asset}:${ref.name}`)||ref);
    const sprites=c._spriteMap||cat?._spritesByKey;
    if(sprites&&c._key!==undefined){
      const chosen=sprites._list.find(x=>x.Key===c._key)?.Value||c._defaultSprite;
      const im=component(target(c._image,n),'Image');if(im)im.m_Sprite=chosen||null;
      const countText=component(target(c._countText),'TextMeshProUGUI');if(countText)countText.m_text=String(c._key);
    }
    if(cat?._gradientsByKey&&c._key!==undefined){
      const chosen=cat._gradientsByKey._list.find(x=>x.Key===c._key)?.Value;
      const grad=component(target(c._gradientImage,n),'UIGradientImage');if(chosen&&grad)grad._gradient=chosen;
    }
    if(c.class==='Slider'){
      const value=c.m_WholeNumbers?Math.round(c.m_Value):c.m_Value;
      const t=Math.max(0,Math.min(1,(value-c.m_MinValue)/(c.m_MaxValue-c.m_MinValue||1)));
      const axis=c.m_Direction<2?'x':'y',reverse=c.m_Direction===1||c.m_Direction===3;
      const fill=target(c.m_FillRect),handle=target(c.m_HandleRect),im=component(fill,'Image');
      if(im?.m_Type===3)im.m_FillAmount=t;
      else if(fill?.rect){fill.rect.m_AnchorMin={x:0,y:0};fill.rect.m_AnchorMax={x:1,y:1};fill.rect[reverse?'m_AnchorMin':'m_AnchorMax'][axis]=reverse?1-t:t;}
      if(handle?.rect){handle.rect.m_AnchorMin={x:0,y:0};handle.rect.m_AnchorMax={x:1,y:1};handle.rect.m_AnchorMin[axis]=handle.rect.m_AnchorMax[axis]=reverse?1-t:t;}
    }
    if(c.class==='Toggle'){
      const graphic=target(c.graphic),im=component(graphic,'Image');
      if(im)im.m_Color={...im.m_Color,a:c.m_IsOn?1:0};
    }
    // UIToggle.SwitchObjects, ELF 0x6ac4e74 (hash-checked C in data/evidence).
    if(c.class==='UIToggle'&&c._previewIsOn!==undefined){
      const checked=target(c._checked),unchecked=target(c._unchecked);
      if(checked)checked.active=c._previewIsOn;if(unchecked)unchecked.active=!c._previewIsOn;
    }
    // ApplyToggleVisual/GetResourceSet, ELF 0x647fcb8 / 0x64888e0.
    if(c.class==='UIToggleButtonFrame'){
      const set=c._toggleImages?.find(x=>x.VisualType===c._toggleVisualType&&x.State===c._state);
      if(set){const frame=component(target(c._frameImage),'Image'),shadow=component(target(c._shadowImage),'Image');if(frame)frame.m_Sprite=set.ToggleSprite;if(shadow)shadow.m_Sprite=set.ShadowSprite;}
    }
    if(c.class==='UIButton'&&c._previewState){
      const states=(c._buttonStates||[]).map(ref=>component(target(ref),ref.class)).filter(Boolean);
      states.push(...n.components.filter(x=>x.class==='ButtonActiveState'));
      for(const item of states){
        if(item.class!=='ButtonActiveState')continue;const go=target(item._target);
        const field={normal:'_normaledActive',highlighted:'_highlightedActive',pressed:'_pressedActive',selected:'_selectedActive',disabled:'_disabledActive'}[c._previewState];
        if(go&&field)go.active=!!item[field];
      }
    }
  }
  }
}

// AnimationClip path hashes use Unity's CRC32 over UTF-8 relative transform paths.
const crcTable=Array.from({length:256},(_,i)=>{for(let b=0;b<8;b++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
export function pathCRC(s){let crc=0xffffffff;for(const b of new TextEncoder().encode(s))crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function sampleClip(clip,time){
  const streamed=clip.streamed||{},dense=clip.dense||{},values=[];
  const keys=Array.from({length:streamed.curveCount||0},()=>null);
  for(const [t,rows] of streamed.frames||[]){if(t>time)break;for(const row of rows)if(row[0]<keys.length)keys[row[0]]={t,row};}
  for(let i=0;i<keys.length;i++){
    const key=keys[i];if(!key){values.push(undefined);continue;}
    const [,a,b,c,d]=key.row,dt=key.t< -1e20?0:time-key.t;
    values.push(((a*dt+b)*dt+c)*dt+d);
  }
  const count=dense.curveCount||0,max=Math.max(0,(dense.frameCount||1)-1);
  const f=Math.max(0,Math.min(max,(time-(dense.beginTime||0))*(dense.sampleRate||0))),lo=Math.floor(f),hi=Math.min(max,lo+1);
  for(let i=0;i<count;i++){const a=dense.samples[lo*count+i],b=dense.samples[hi*count+i];values.push(a+(b-a)*(f-lo));}
  return values.concat(clip.constant||[]);
}
// Unity 6 keeps object-reference indices in the discrete tail of streamed data.
// These indices do not consume entries in the numeric/dense/constant sequence.
export function sampleObjectCurves(clip,time){
  const streamed=clip.streamed||{},count=streamed.discreteCurveCount||0,start=streamed.curveCount||0;
  const values=Array(count).fill(undefined);
  for(const [t,rows] of streamed.frames||[]){if(t>time)break;for(const row of rows){const i=row[0]-start;if(i>=0&&i<count)values[i]=row[4];}}
  return values;
}
const unsafeFields=new Set(['__proto__','prototype','constructor']);
const fieldParts=path=>typeof path==='string'&&path&&!path.split('.').some(p=>!p||unsafeFields.has(p))?path.split('.'):null;
export function assignField(obj,path,value){const parts=fieldParts(path);if(!parts)return false;let parent=obj;for(const p of parts.slice(0,-1)){if(!parent||!Object.hasOwn(parent,p))return false;parent=parent[p];}if(!parent||!Object.hasOwn(parent,parts.at(-1)))return false;const key=parts.at(-1);parent[key]=typeof parent[key]==='boolean'&&typeof value==='number'?value>=.5:value;return true;}
const readField=(obj,path)=>fieldParts(path)?.reduce((v,key)=>v&&Object.hasOwn(v,key)?v[key]:undefined,obj);
function findAttribute(obj,crc){
  const candidates=[];
  function walk(v,prefix,depth){if(depth>3||!v||typeof v!=='object'||Array.isArray(v))return;for(const [key,value] of Object.entries(v)){const path=prefix?prefix+'.'+key:key;if(pathCRC(path)===crc)candidates.push(path);else if(value&&typeof value==='object')walk(value,path,depth+1);}}
  walk(obj,'',0);return candidates.length===1?candidates[0]:null;
}
export function clipPose(pack,clip,rootPath,time){
  const nodes=pack.document.nodes||[],paths=new Map(),crcs=new Map(),indices=new Map(),values=sampleClip(clip,time),objects=sampleObjectCurves(clip,time),missing=[],diagnostics=[],pose=new Map();
  const rootIndex=typeof rootPath==='number'?rootPath:nodes.findIndex(n=>n.path===rootPath),root=nodes[rootIndex],rootMatches=nodes.filter(n=>n.path===root?.path).length;
  if(root&&(typeof rootPath==='number'||rootMatches===1)){
    const depth=root.path.split('/').length;
    for(let i=rootIndex;i<nodes.length;i++){
      const n=nodes[i];if(i!==rootIndex&&n.path.split('/').length<=depth)break;
      const rel=i===rootIndex?'':n.path.slice(root.path.length+1);indices.set(n,i);paths.set(rel,[...(paths.get(rel)||[]),n]);const crc=pathCRC(rel);crcs.set(crc,[...(crcs.get(crc)||[]),n]);
    }
  }
  let offset=0,objectOffset=0,applied=0,numericApplied=0,objectApplied=0;
  const put=(n,ci,field,value)=>{const target=ci===null?n:n.components[ci];if(readField(target,field)===undefined)return false;const nodeIndex=indices.get(n),key=nodeIndex+'|'+ci+'|'+field;pose.set(key,{node:n.path,nodeIndex,componentIndex:ci,field,value});return true;};
  const fail=(binding,reason,extra={})=>{missing.push(binding);diagnostics.push({binding,reason,...extra});};
  for(const b of clip.bindings||[]){
    const matches=b.pathCrc!==undefined?crcs.get(b.pathCrc):b.path!=null?paths.get(b.path):null,n=matches?.length===1?matches[0]:null;
    const vector=['Transform','RectTransform'].includes(b.class)&&['m_LocalPosition','m_LocalScale','m_LocalRotation','localEulerAnglesRaw'].includes(b.attribute);
    const size=b.curves||(vector?(b.attribute==='m_LocalRotation'?4:3):1),v=b.pptr?[objects[objectOffset++]]:values.slice(offset,offset+size);if(!b.pptr)offset+=size;
    if(!n){fail(b,matches?.length>1||rootMatches>1&&typeof rootPath!=='number'?'ambiguous_path':'target_not_found');continue;}
    if(v.length!==size&&!b.pptr||v.some(x=>!Number.isFinite(x))){fail(b,'sample_not_found');continue;}
    const ci=n.components.findIndex(c=>(c.class||c.type)===b.class),c=n.components[ci];
    const attribute=b.attribute||findAttribute(c,b.attributeCrc);
    let ok=false;
    if(b.pptr){
      const index=Math.round(v[0]),mapping=clip.pptrCurveMapping||[];
      if(index>=mapping.length){fail(b,'object_reference_not_found',{index});continue;}
      if(ci<0){fail(b,'component_not_found',{node:n.path});continue;}
      ok=attribute&&put(n,ci,attribute,index<0?null:mapping[index]);
    }
    else if(b.class==='GameObject'&&b.attribute==='m_IsActive')ok=put(n,null,'active',v[0]>=.5);
    else if(vector){
      const field={m_LocalPosition:'localPosition',m_LocalScale:'localScale',m_LocalRotation:'localRotation',localEulerAnglesRaw:'euler'}[b.attribute];
      if(field==='localPosition'&&n.rect){for(const [i,axis] of ['x','y'].entries())put(n,null,'rect.m_AnchoredPosition.'+axis,n.rect.m_AnchoredPosition[axis]+v[i]-(n.localPosition?.[axis]||0));}
      // Euler is a runtime channel, absent from the original quaternion transform.
      if(field==='euler')pose.set(indices.get(n)+'|null|euler',{node:n.path,nodeIndex:indices.get(n),componentIndex:null,field,value:{x:v[0],y:v[1],z:v[2]}});
      else for(const [i,axis] of ['x','y','z','w'].slice(0,size).entries())put(n,null,field+'.'+axis,v[i]);
      ok=true;
    }else if(b.class==='RectTransform'&&attribute?.startsWith('m_LocalPosition.')){
      const axis=attribute.split('.').at(-1);if(n.rect&&['x','y'].includes(axis))put(n,null,'rect.m_AnchoredPosition.'+axis,n.rect.m_AnchoredPosition[axis]+v[0]-(n.localPosition?.[axis]||0));ok=put(n,null,'localPosition.'+axis,v[0]);
    }else if(attribute&&b.class==='RectTransform')ok=put(n,null,'rect.'+attribute,v[0]);
    else if(attribute&&b.class==='Transform'){
      const field=attribute.replace(/^m_Local(Position|Scale|Rotation)/,(_,s)=>'local'+s);ok=put(n,null,field,v[0]);
    }else if(attribute&&ci>=0){const value=b.int?Math.round(v[0]):v[0];ok=put(n,ci,attribute,typeof readField(c,attribute)==='boolean'?value>=.5:value);}
    if(ok){applied++;b.pptr?objectApplied++:numericApplied++;}
    else fail(b,ci<0&&!['Transform','RectTransform','GameObject'].includes(b.class)?'component_not_found':attribute?'field_not_found':'attribute_not_resolved',{node:n.path});
  }
  return {applied,numericApplied,objectApplied,missing,diagnostics,pose};
}
export function writePose(pack,pose){
  const nodes=nodeMap(pack);
  for(const op of pose.values()){
    const n=op.nodeIndex!==undefined?pack.document.nodes[op.nodeIndex]:nodes.get(op.node);if(!n)continue;const target=op.componentIndex===null?n:n.components[op.componentIndex];
    if(op.field==='euler'&&op.componentIndex===null)target.euler=op.value;else assignField(target,op.field,op.value);
  }
}
export function applyClip(pack,clip,rootPath,time){
  const result=clipPose(pack,clip,rootPath,time);writePose(pack,result.pose);const {pose,...report}=result;return report;
}
export function mergeResources(pack,resources){
  pack.resources||={};for(const kind of ['sprites','textures','fonts','fontMetricsByAsset'])pack.resources[kind]={...pack.resources[kind],...resources?.[kind]};if(resources?.fontMetrics)pack.resources.fontMetrics=resources.fontMetrics;return pack;
}
