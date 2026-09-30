import {component,applyBindings,applyClip,mergeResources,resolveNodeIndex} from './runtime.js';
import {AnimatorRuntime} from './animator.js';
import {SequenceRuntime} from './tween.js';

const unsafe=new Set(['__proto__','prototype','constructor']);

// UI preview state independent of the DOM. Serialized originals stay untouched.
export class UISession {
  constructor(pack,{bindings=true}={}){
    if(!pack?.document||!pack.resources)throw Error('UI pack requires document and resources');
    this.raw=structuredClone(pack);this.bindings=bindings;this.edits=new Map();this.controllers=new Map();this.time=0;this.root=0;this.motion=null;this.report=null;
  }
  get nodes(){return this.raw.document.nodes||[];}
  get animators(){return this.nodes.flatMap((n,index)=>component(n,'Animator')?[{index,path:n.path,name:component(n,'Animator').m_Controller?.name||component(n,'Animator').m_Controller?.controller}]:[]);}
  get sequences(){return this.nodes.flatMap((n,index)=>component(n,'DOTweenSequence')?[{index,path:n.path,name:n.name}]:[]);}
  edit(selector,componentName,field,value){
    const index=resolveNodeIndex(this.raw,selector),node=this.nodes[index],parts=field.split('.');if(parts.some(p=>unsafe.has(p)))throw Error('Invalid UI field');
    const ci=componentName===null?null:node.components.findIndex(c=>(c.class||c.type)===componentName);if(ci===-1)throw Error('UI component not found: '+componentName);
    const target=ci===null?node:node.components[ci];let parent=target;for(const p of parts.slice(0,-1)){if(!parent||typeof parent[p]!=='object')throw Error('UI field not found: '+field);parent=parent[p];}
    this.edits.set(`${index}:${ci}:${field}`,{index,ci,parts,value:structuredClone(value)});return this;
  }
  setController(selector,controller){const index=resolveNodeIndex(this.raw,selector);this.controllers.set(index,controller);this.animatorIndex=index;return this;}
  playState(state){
    const controller=this.controllers.get(this.animatorIndex);if(!controller)throw Error('Select a UI Animator first');
    const runtime=new AnimatorRuntime(controller.document,this.animatorIndex),index=typeof state==='number'?state:runtime.machine.states.findIndex(s=>s.name===state||s.path===state);
    runtime.play(index);this.motion={kind:'state',runtime,controller};this.time=0;return this;
  }
  selectClip(clip){
    const controller=this.controllers.get(this.animatorIndex);if(!controller)throw Error('Select a UI Animator first');
    const selected=typeof clip==='number'?controller.document.clips[clip]:controller.document.clips.find(c=>c.clip===clip);
    if(!selected?.bindings)throw Error('UI clip not found: '+clip);this.motion={kind:'clip',clip:selected,root:this.animatorIndex,controller};this.time=selected.startTime||0;return this;
  }
  selectSequence(selector){const index=resolveNodeIndex(this.raw,selector);this.motion={kind:'sequence',runtime:new SequenceRuntime(this.raw,index,this.controllers)};this.time=0;return this;}
  setParameter(name,value){if(this.motion?.kind!=='state')throw Error('Select a UI Animator state first');this.motion.runtime.setParameter(name,value);return this;}
  seek(time){if(!Number.isFinite(time)||time<0)throw Error('UI time must be a nonnegative finite number');this.time=time;if(this.motion?.kind==='state')this.motion.runtime.seek(time);return this;}
  update(delta){if(!Number.isFinite(delta)||delta<0)throw Error('UI delta must be a nonnegative finite number');this.time+=delta;if(this.motion?.kind==='state')this.motion.runtime.advance(delta);return this;}
  reset(){this.motion=null;this.time=0;this.edits.clear();this.report=null;this.root=0;return this;}
  prepare(){
    const pack=structuredClone(this.raw);for(const {index,ci,parts,value} of this.edits.values()){let target=ci===null?pack.document.nodes[index]:pack.document.nodes[index].components[ci];for(const key of parts.slice(0,-1))target=target[key];target[parts.at(-1)]=structuredClone(value);}
    if(this.bindings)applyBindings(pack);
    const m=this.motion;
    if(m?.controller)mergeResources(pack,m.controller.resources);
    if(m?.kind==='state')this.report=m.runtime.apply(pack);
    else if(m?.kind==='clip'){let time=this.time;const c=m.clip,length=c.stopTime-c.startTime;if(c.loopTime&&length>0)time=c.startTime+((time-c.startTime)%length+length)%length;else time=Math.min(c.stopTime,time);this.report=applyClip(pack,c,m.root,time);}
    else if(m?.kind==='sequence'){m.runtime.baseline=structuredClone(pack);this.report=m.runtime.apply(pack,this.time);}
    else this.report={applied:0,numericApplied:0,objectApplied:0,missing:[],diagnostics:[]};
    return pack;
  }
}
