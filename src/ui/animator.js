import {clipPose,writePose,nodeMap} from './runtime.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mod=(v,n)=>((v%n)+n)%n;
const field=(obj,path)=>path.split('.').reduce((v,k)=>v?.[k],obj);

export function controllerParameters(controller){
  const data=controller.defaultValues?.data||controller.defaultValues||{};
  return Object.fromEntries((controller.parameters||[]).map(p=>{
    const values=data[p.type===1?'m_FloatValues':p.type===3?'m_IntValues':'m_BoolValues']||[];
    return [p.name,p.type===9?false:values[p.index]??(p.type===4?false:0)];
  }));
}

export function stateMotion(controller,state){
  const trees=state?.blendTrees||[],nodes=trees.flat();
  if(nodes.some(n=>n.children?.length))return {unsupported:'blend_tree',duration:1};
  const motions=nodes.filter(n=>Number.isInteger(n.clip)&&controller.clips[n.clip]);
  if(motions.length>1)return {unsupported:'multiple_motions',duration:1};
  const clip=motions.length?controller.clips[motions[0].clip]:null;
  return {clip,duration:Math.max(.000001,clip?(clip.stopTime-clip.startTime):1)};
}

export function transitionConditions(transition,parameters){
  return (transition.conditions||[]).every(c=>{
    const v=parameters[c.event];
    switch(c.mode){case 1:return !!v;case 2:return !v;case 3:return v>c.threshold;case 4:return v<c.threshold;case 6:return v===c.threshold;case 7:return v!==c.threshold;default:return false;}
  });
}

function blendPose(from,to,weight,pack){
  const nodes=nodeMap(pack),result=new Map();
  for(const key of new Set([...from.keys(),...to.keys()])){
    const a=from.get(key),b=to.get(key),op=b||a,n=op.nodeIndex!==undefined?pack.document.nodes[op.nodeIndex]:nodes.get(op.node),target=op.componentIndex===null?n:n?.components[op.componentIndex];
    const base=field(target,op.field),av=a?a.value:base,bv=b?b.value:base;
    if(av===undefined&&bv===undefined)continue;
    const value=typeof av==='number'&&typeof bv==='number'?av+(bv-av)*weight:weight<.5?(av??bv):(bv??av);
    result.set(key,{...op,value});
  }
  // Normalize interpolated quaternions. UI rotations are normally Euler curves.
  const rotations=new Map();
  for(const [key,op] of result)if(op.componentIndex===null&&op.field.startsWith('localRotation.')){
    const identity=op.nodeIndex??op.node;if(!rotations.has(identity))rotations.set(identity,[]);rotations.get(identity).push([key,op]);
  }
  for(const ops of rotations.values())if(ops.length===4){const length=Math.hypot(...ops.map(([,o])=>o.value));if(length)for(const [key,op] of ops)result.set(key,{...op,value:op.value/length});}
  return result;
}

// Serialized single-layer Animator controllers used by this UI library.
// Animation events are collected as data; native callbacks are not executed.
export class AnimatorRuntime {
  constructor(controller,rootPath){
    this.controller=controller;this.rootPath=rootPath;this.machine=controller.stateMachines?.[controller.layers?.[0]?.stateMachine||0];
    this.defaults=controllerParameters(controller);this.parameterEvents=[];this.startState=this.machine?.defaultState||0;
    this.warnings=[];if((controller.layers||[]).length!==1)this.warnings.push('unsupported_layer_count');
    this.reset();
  }
  reset(){
    this.parameters={...this.defaults};this.timelineTime=0;this.current={index:this.startState,normalized:0};
    this.transition=null;this.exited=false;this.heldPose=new Map();this.pendingStates=[];this.events=[];this.lastResult=null;
    this.parameterCursor=0;return this;
  }
  play(index){
    if(!this.machine?.states[index])throw Error('Animator state does not exist: '+index);
    this.startState=index;this.parameterEvents=[];this.reset();this.advance(0);return this;
  }
  crossFade(index,normalizedDuration=0){
    if(!this.machine?.states[index])throw Error('Animator state does not exist: '+index);
    this.beginTransition({destination:index,duration:normalizedDuration,fixedDuration:false,offset:0,conditions:[]});return this;
  }
  setParameter(name,value){
    const p=this.controller.parameters?.find(p=>p.name===name);if(!p)throw Error('Animator parameter does not exist: '+name);
    if(p.type===4||p.type===9)value=!!value;else if(p.type===3)value=Math.round(value);else value=Number(value);
    if(typeof value==='number'&&!Number.isFinite(value))throw Error('Animator parameter must be finite: '+name);
    this.parameterEvents=this.parameterEvents.filter(e=>e.time<=this.timelineTime);
    this.parameterEvents.push({time:this.timelineTime,name,value});this.parameterCursor=this.parameterEvents.length;
    this.parameters[name]=value;this.advance(0);return this;
  }
  seek(time){
    const history=this.parameterEvents.slice();this.reset();this.parameterEvents=history;
    this.advance(Math.max(0,time));return this;
  }
  stateInfo(cursor=this.current){
    const state=this.machine?.states[cursor?.index],motion=stateMotion(this.controller,state);
    const speed=(state?.speed??1)*(state?.speedParam?Number(this.parameters[state.speedParam]??1):1);
    return {state,...motion,speed};
  }
  sampleTime(cursor){
    const {state,clip,duration}=this.stateInfo(cursor);if(!clip)return 0;
    let normalized=state.timeParam?Number(this.parameters[state.timeParam]??0):cursor.normalized;
    normalized+=(state.cycleOffset||0)+(clip.cycleOffset||0);
    normalized=state.loop||clip.loopTime?mod(normalized,1):clamp(normalized,0,1);
    return (clip.startTime||0)+normalized*duration;
  }
  eligible(t,cursor){
    // Unity ignores transitions with neither a condition nor an exit time.
    if(!t.hasExitTime&&!(t.conditions||[]).length)return false;
    if(!transitionConditions(t,this.parameters))return false;
    if(t.destination===cursor.index&&!t.canTransitionToSelf)return false;
    if(!t.hasExitTime)return true;
    const {state,clip}=this.stateInfo(cursor),exit=t.exitTime||0;
    if((state?.loop||clip?.loopTime)&&exit<1){const progress=mod(cursor.normalized,1);return progress+1e-8>=exit&&progress<=exit+1/60;}
    return cursor.normalized+1e-8>=exit;
  }
  beginTransition(t){
    const from={...this.current},info=this.stateInfo(from),duration=Math.max(0,(t.duration||0)*(t.fixedDuration?1:info.duration));
    const exit=t.destination===30001;
    if(!exit&&!this.machine.states[t.destination]){if(!this.warnings.includes('unsupported_destination:'+t.destination))this.warnings.push('unsupported_destination:'+t.destination);return false;}
    for(const c of t.conditions||[])if(this.controller.parameters?.some(p=>p.name===c.event&&p.type===9))this.parameters[c.event]=false;
    if(!duration){this.pendingStates.push(from);this.current=exit?from:{index:t.destination,normalized:t.offset||0};this.exited=exit;return true;}
    this.transition={from,to:exit?null:{index:t.destination,normalized:t.offset||0},elapsed:0,duration,name:t.name};return true;
  }
  checkTransitions(){
    if(this.transition||this.exited||!this.machine)return;
    const state=this.stateInfo().state;
    const candidates=[...(this.machine.anyStateTransitions||[]),...(state?.transitions||[])];
    const next=candidates.find(t=>this.eligible(t,this.current));if(next)this.beginTransition(next);
  }
  collectEvents(cursor,before,after){
    const {state,clip,duration}=this.stateInfo(cursor);if(!clip?.events?.length||after<before)return;
    const offset=(state.cycleOffset||0)+(clip.cycleOffset||0),loop=state.loop||clip.loopTime;
    for(const event of clip.events){
      const normalized=((event.time||0)-(clip.startTime||0))/duration;
      const first=loop?Math.floor(before+offset)-1:0,last=loop?Math.ceil(after+offset):0;
      for(let cycle=first;cycle<=last;cycle++){
        const at=normalized+cycle-offset;if(at>before+1e-8&&at<=after+1e-8)this.events.push({...event,clip:clip.clip,state:state.name,at:this.timelineTime});
      }
    }
    if(this.events.length>100)this.events.splice(0,this.events.length-100);
  }
  advanceCursor(cursor,dt){
    const info=this.stateInfo(cursor);if(!info.state)return;
    const before=cursor.normalized;cursor.normalized+=dt*info.speed/info.duration;this.collectEvents(cursor,before,cursor.normalized);
  }
  advance(delta){
    if(!Number.isFinite(delta)||delta<0)throw Error('Animator delta must be a nonnegative finite number');
    const end=this.timelineTime+delta;let count=0;
    do{
      while(this.parameterCursor<this.parameterEvents.length&&this.parameterEvents[this.parameterCursor].time<=this.timelineTime+1e-8){const event=this.parameterEvents[this.parameterCursor++];this.parameters[event.name]=event.value;}
      this.checkTransitions();
      const nextParameter=this.parameterEvents[this.parameterCursor]?.time??Infinity;
      const dt=Math.max(0,Math.min(1/120,end-this.timelineTime,nextParameter-this.timelineTime));
      if(dt>0){
        if(this.transition){
          const t=this.transition;this.advanceCursor(t.from,dt);if(t.to)this.advanceCursor(t.to,dt);t.elapsed+=dt;
          if(t.elapsed+1e-8>=t.duration){this.pendingStates.push(t.from);this.current=t.to||t.from;this.exited=!t.to;this.transition=null;}
        }else if(!this.exited)this.advanceCursor(this.current,dt);
        this.timelineTime+=dt;
      }
      if(++count>120000)throw Error('Animator preview exceeded 1000 seconds');
    }while(this.timelineTime+1e-8<end);
    this.checkTransitions();return this;
  }
  apply(pack){
    const reports=[];
    const sample=(cursor,collect=true)=>{
      const {state,clip,unsupported}=this.stateInfo(cursor);
      if(unsupported&&!this.warnings.includes(unsupported))this.warnings.push(unsupported);
      const report=clip?.bindings?clipPose(pack,clip,this.rootPath,this.sampleTime(cursor)):{pose:new Map(),applied:0,numericApplied:0,objectApplied:0,missing:[],diagnostics:[]};
      if(collect)reports.push(report);return {state,pose:report.pose};
    };
    for(const cursor of this.pendingStates){const r=sample(cursor,false);if(r.state?.writeDefaultValues)this.heldPose.clear();for(const [key,op] of r.pose)this.heldPose.set(key,op);}
    this.pendingStates=[];
    let pose;
    if(this.transition){
      const t=this.transition,a=sample(t.from),b=t.to?sample(t.to):{state:null,pose:a.pose};
      const from=new Map(a.state?.writeDefaultValues?[]:this.heldPose);for(const [k,v] of a.pose)from.set(k,v);
      const to=new Map(b.state?.writeDefaultValues?[]:from);for(const [k,v] of b.pose)to.set(k,v);
      pose=blendPose(from,to,clamp(t.elapsed/t.duration,0,1),pack);
    }else{
      const r=sample(this.current);pose=new Map(r.state?.writeDefaultValues?[]:this.heldPose);for(const [key,op] of r.pose)pose.set(key,op);
    }
    writePose(pack,pose);this.heldPose=pose;
    const state=this.stateInfo(this.transition?.to||this.current).state;
    this.lastResult={state:state?.name,normalizedTime:this.current.normalized,exited:this.exited,transition:this.transition?.name||null,
      applied:reports.reduce((n,r)=>n+r.applied,0),numericApplied:reports.reduce((n,r)=>n+r.numericApplied,0),objectApplied:reports.reduce((n,r)=>n+r.objectApplied,0),
      missing:reports.flatMap(r=>r.missing),diagnostics:reports.flatMap(r=>r.diagnostics),events:this.events,warnings:this.warnings};
    return this.lastResult;
  }
}
