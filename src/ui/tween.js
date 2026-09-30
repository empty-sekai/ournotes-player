import {component,mergeResources,referenceNode,resolveNodeIndex,nodeReferences} from './runtime.js';
import {AnimatorRuntime} from './animator.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mod=(v,n)=>((v%n)+n)%n;
const refPath=ref=>ref?.gameObject||ref?.transform;
const calls=event=>(event?.m_PersistentCalls?.m_Calls||[]).filter(c=>c.m_CallState!==0&&c.m_Target&&c.m_MethodName);

export function tweenEase(type,t){
  t=clamp(t,0,1);
  if(type===0||type===1)return t;
  if(type===2)return 1-Math.cos(t*Math.PI/2);
  if(type===3)return Math.sin(t*Math.PI/2);
  if(type===4)return (1-Math.cos(t*Math.PI))/2;
  if(type>=5&&type<=16){const power=Math.floor((type-5)/3)+2,mode=(type-5)%3;return mode===0?t**power:mode===1?1-(1-t)**power:t<.5?(2*t)**power/2:1-(2*(1-t))**power/2;}
  if(type===17)return t===0?0:2**(10*t-10);
  if(type===18)return t===1?1:1-2**(-10*t);
  if(type===19)return t===0||t===1?t:t<.5?2**(20*t-10)/2:(2-2**(-20*t+10))/2;
  if(type===20)return 1-Math.sqrt(1-t*t);
  if(type===21)return Math.sqrt(1-(t-1)**2);
  if(type===22)return t<.5?(1-Math.sqrt(1-(2*t)**2))/2:(Math.sqrt(1-(-2*t+2)**2)+1)/2;
  throw Error('Unsupported DOTween ease: '+type);
}

function animationDuration(c){return Math.max(0,c.delay||0)+Math.max(0,c.duration||0)*(c.loops<0?1:Math.max(1,c.loops||1));}

// Timing is from hash-checked CreateSequence (ELF 0x6aded88): Insert atPosition,
// then advance by the command's positive serialized _duration. Zero durations
// place consecutive tweens in parallel, rather than appending them.
export function sequencePlan(pack,rootPath,stack=new Set()){
  const rootIndex=resolveNodeIndex(pack,rootPath),node=pack.document.nodes[rootIndex],sequence=component(node,'DOTweenSequence'),items=[],diagnostics=[];rootPath=node.path;
  if(!sequence)return {rootPath,duration:0,items,diagnostics:[{reason:'sequence_not_found',node:rootPath}]};
  if(stack.has(rootIndex))return {rootPath,duration:0,items,diagnostics:[{reason:'sequence_cycle',node:rootPath}]};
  stack=new Set([...stack,rootIndex]);let position=0,duration=0;
  for(const [index,command] of sequence._list.entries()){
    if(command._commandType===1){for(const call of calls(command._tweenEvent))items.push({kind:'callback',start:position,call,index,ownerIndex:rootIndex});}
    else if(command._commandType===0){
      const resolved=referenceNode(pack,command._tweenAnimation,rootIndex),target=resolved?.node,animations=target?.components.filter(c=>['DOTweenAnimation','DOTweenSequence'].includes(c.class))||[];
      const selected=animations[command._tweenIndex]||component(target,command._tweenAnimation?.class);
      if(target?.path===rootPath&&selected===sequence)continue;
      if(!selected)diagnostics.push({reason:'tween_not_found',index,node:refPath(command._tweenAnimation)});
      else if(selected.class==='DOTweenSequence'){
        const nested=sequencePlan(pack,resolved.index,stack);items.push(...nested.items.map(item=>({...item,start:item.start+position})));diagnostics.push(...nested.diagnostics);duration=Math.max(duration,position+nested.duration);
      }else{items.push({kind:'tween',start:position,animation:selected,owner:target.path,ownerIndex:resolved.index,index});duration=Math.max(duration,position+animationDuration(selected));}
    }else if(command._commandType!==2)diagnostics.push({reason:'command_not_supported',index,type:command._commandType});
    position+=Math.max(0,command._duration||0);duration=Math.max(duration,position);
  }
  return {rootPath,rootIndex,sequence,duration,items,diagnostics};
}

export function sequenceAnimatorCalls(pack,plan){
  const result=[];
  for(const item of plan.items.filter(item=>item.kind==='callback')){
    const resolved=referenceNode(pack,item.call.m_Target,item.ownerIndex??plan.rootIndex),node=resolved?.node,trigger=component(node,'SimpleAnimationTrigger');
    const animator=trigger?._animator?referenceNode(pack,trigger._animator,resolved.index):resolved,root=animator?.node.path;
    result.push({...item,node:node?.path,nodeIndex:resolved?.index,root,rootIndex:animator?.index,state:item.call.m_Arguments?.m_StringArgument,blendTime:trigger?._blendTime||0,
      supported:item.call.m_Target?.class==='SimpleAnimationTrigger'&&item.call.m_MethodName==='PlayAnimation'&&item.call.m_Mode===5&&!!trigger&&!!component(animator?.node,'Animator')});
  }
  return result;
}

function progress(animation,time){
  const elapsed=time-(animation.delay||0),duration=Math.max(.000001,animation.duration||0),loops=animation.loops<0?Infinity:Math.max(1,animation.loops||1);
  if(elapsed<0)return null;
  const complete=elapsed>=duration*loops,cycle=complete?loops-1:Math.floor(elapsed/duration);
  let t=complete?1:mod(elapsed,duration)/duration;if(animation.loopType===1&&cycle%2)t=1-t;
  return {value:tweenEase(animation.easeType,t),cycle:animation.loopType===2?cycle:0};
}

function tweenTarget(pack,owner,a){
  const ownerIndex=resolveNodeIndex(pack,owner),target=a.targetIsSelf?{node:pack.document.nodes[ownerIndex],index:ownerIndex}:referenceNode(pack,a.targetGO||a.target,ownerIndex);
  return target||{};
}

// Existing UI data uses LocalMove, world Z rotation, CanvasGroup Fade, and
// UIWidthHeight. Additional basic transform/graphic cases share these rules.
export function applyTween(pack,baseline,owner,a,time){
  const diagnostics=[],result={applied:0,diagnostics};
  if(!a.isActive||!a.isValid)return result;
  if(a.isSpeedBased){diagnostics.push({reason:'speed_based_tween_not_supported',node:owner});return result;}
  let p;try{p=progress(a,time);}catch(error){diagnostics.push({reason:error.message,node:owner});return result;}if(!p)return result;
  const {node,index}=tweenTarget(pack,owner,a),original=tweenTarget(baseline,owner,a).node;
  if(!node||!original){diagnostics.push({reason:'tween_target_not_found',node:owner});return result;}
  const interpolate=(start,end,relative=a.isRelative)=>{
    let from=a.isFrom?(relative?start+end:end):start,to=a.isFrom?start:(relative?start+end:end);
    const difference=to-from;return from+difference*(p.value+p.cycle);
  };
  const axes=['x','y','z'];
  switch(a.animationType){
    case 2:
      for(const axis of axes){const start=original.localPosition?.[axis]||0;let value=interpolate(start,a.endValueV3[axis]);if(a.optionalBool0)value=Math.round(value);node.localPosition[axis]=value;if(node.rect&&axis!=='z')node.rect.m_AnchoredPosition[axis]=original.rect.m_AnchoredPosition[axis]+value-start;}break;
    case 3:case 4:{
      if(a.optionalRotationMode>1){diagnostics.push({reason:'rotation_mode_not_supported',node:owner});return result;}
      const q=original.localRotation||{z:0,w:1},initial=original.euler||{x:0,y:0,z:2*Math.atan2(q.z,q.w)*180/Math.PI};
      let parentZ=0;
      if(a.animationType===3){const refs=nodeReferences(pack);for(let i=refs.parents[index];i>=0;i=refs.parents[i]){const parent=refs.nodes[i],r=parent.localRotation;parentZ+=parent.euler?.z??(r?2*Math.atan2(r.z,r.w)*180/Math.PI:0);}}
      node.euler={};
      for(const axis of axes){const start=initial[axis]||0;let end=a.endValueV3[axis]-(axis==='z'&&!a.isRelative?parentZ:0);if(a.optionalRotationMode===0&&!a.isRelative)end=start+mod(end-start+180,360)-180;node.euler[axis]=interpolate(start,end);}break;
    }
    case 5:
      for(const axis of axes)node.localScale[axis]=interpolate(original.localScale[axis],a.optionalBool0?a.endValueFloat:a.endValueV3[axis]);break;
    case 6:case 7:{
      const cls={2:'CanvasGroup',3:'Image',7:'SpriteRenderer',10:'Text',14:'TextMeshPro',15:'TextMeshProUGUI'}[a.targetType],target=component(node,cls),base=component(original,cls);
      if(!target||!base){diagnostics.push({reason:'tween_component_not_found',node:node.path,class:cls});return result;}
      if(a.animationType===7){if(cls==='CanvasGroup')target.m_Alpha=interpolate(base.m_Alpha,a.endValueFloat,false);else{const field=cls.startsWith('TextMeshPro')?'m_fontColor':'m_Color';target[field].a=interpolate(base[field].a,a.endValueFloat,false);}}
      else{const field=cls.startsWith('TextMeshPro')?'m_fontColor':'m_Color';if(!target[field]){diagnostics.push({reason:'tween_color_not_found',node:node.path});return result;}for(const axis of ['r','g','b','a'])target[field][axis]=interpolate(base[field][axis],a.endValueColor[axis],false);}break;
    }
    case 21:
      if(!node.rect){diagnostics.push({reason:'rect_transform_not_found',node:node.path});return result;}
      for(const axis of ['x','y'])node.rect.m_SizeDelta[axis]=interpolate(original.rect.m_SizeDelta[axis],a.optionalBool0?a.endValueFloat:a.endValueV2[axis]);break;
    default:diagnostics.push({reason:'tween_animation_not_supported',node:owner,type:a.animationType});return result;
  }
  result.applied=1;return result;
}

export class SequenceRuntime {
  constructor(pack,rootPath,controllers=new Map()){
    this.plan=sequencePlan(pack,rootPath);this.baseline=pack;this.controllers=controllers;this.calls=sequenceAnimatorCalls(pack,this.plan);
  }
  apply(pack,time){
    const {plan,baseline}=this,diagnostics=[...plan.diagnostics],events=[],animators=new Map();let tweens=0;
    const local=plan.sequence?._isLoop&&plan.duration>0?mod(time,plan.duration):time;
    for(const item of plan.items.filter(item=>item.kind==='tween')){
      const result=applyTween(pack,baseline,item.ownerIndex,item.animation,local-item.start);tweens+=result.applied;diagnostics.push(...result.diagnostics);
    }
    for(const item of this.calls){
      if(item.start>local)continue;
      if(!item.supported){diagnostics.push({reason:'sequence_callback_not_supported',node:item.node,method:item.call.m_MethodName});continue;}
      // SimpleAnimationTrigger checks activeInHierarchy before CrossFade.
      const refs=nodeReferences(pack);let active=true;for(let i=item.nodeIndex;i>=0;i=refs.parents[i])if(refs.nodes[i].active===false)active=false;
      if(!active){events.push({node:item.node,state:item.state,at:item.start,skipped:'inactive_target'});continue;}
      const exported=this.controllers.get(item.rootIndex)||this.controllers.get(item.root);if(!exported){diagnostics.push({reason:'sequence_controller_not_found',node:item.root});continue;}
      mergeResources(pack,exported.resources);
      let entry=animators.get(item.rootIndex);if(!entry){entry={runtime:new AnimatorRuntime(exported.document,item.rootIndex),time:0};animators.set(item.rootIndex,entry);}
      const machine=entry.runtime.machine,index=machine?.states.findIndex(s=>s.name===item.state||s.path===item.state);
      if(index===undefined||index<0){diagnostics.push({reason:'sequence_state_not_found',node:item.root,state:item.state});continue;}
      entry.runtime.advance(Math.max(0,item.start-entry.time));entry.runtime.crossFade(index,item.blendTime);entry.time=item.start;
      events.push({node:item.node,state:item.state,at:item.start});
    }
    let numeric=0,objects=0;
    for(const entry of animators.values()){entry.runtime.advance(Math.max(0,local-entry.time));const result=entry.runtime.apply(pack);numeric+=result.numericApplied;objects+=result.objectApplied;diagnostics.push(...result.diagnostics);}
    return {applied:tweens+numeric+objects,tweens,numericApplied:numeric,objectApplied:objects,missing:diagnostics,diagnostics,events,duration:plan.duration};
  }
}
