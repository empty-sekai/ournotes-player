import {Renderer} from './renderer.js';
import {UISession} from './session.js';
import {UILibrary,resourceURLs} from './library.js';
import {component,resolveNodeIndex} from './runtime.js';
import {sequencePlan,sequenceAnimatorCalls} from './tween.js';

// Canvas 2D prefab preview, distinct from the game's WebGL render paths.
// This exposes the serialized UI restoration work without claiming pixel parity.
export class UIPlayer extends EventTarget {
  static async create(host,options={}){const player=new UIPlayer(host,options);try{await player.load(options.entry??options.src);return player;}catch(error){player.destroy();throw error;}}
  constructor(host,{library=null,assetBase,viewport=[1920,1080],showHidden=false,bounds=false,bindings=true}={}){
    super();if(!host)throw Error('UIPlayer requires a host element');
    this.canvas=host.tagName?.toLowerCase()==='canvas'?host:document.createElement('canvas');if(this.canvas!==host)host.append(this.canvas);
    this.canvas.style.cssText='display:block;max-width:100%;max-height:100%;object-fit:contain';this.context=this.canvas.getContext('2d');if(!this.context)throw Error('Canvas 2D unavailable');
    this.library=library;this.assetBase=assetBase;this._explicitAssetBase=assetBase;this.options={viewport,showHidden,bounds,bindings};this.session=null;this.paused=true;this.destroyed=false;this._revision=0;this._loadRevision=0;this._playRevision=0;this._raf=null;
  }
  emit(name,detail){this.dispatchEvent(new CustomEvent(name,{detail}));}
  get nodes(){return this.session?.nodes||[];}
  get animators(){return this.session?.animators||[];}
  get sequences(){return this.session?.sequences||[];}
  get time(){return this.session?.time||0;}
  get report(){return this.session?.report||null;}
  get duration(){const m=this.session?.motion;return m?.kind==='clip'?m.clip.stopTime:m?.kind==='sequence'?m.runtime.plan.duration:m?.kind==='state'?m.runtime.stateInfo().duration:0;}
  async load(source){
    if(this.destroyed)throw Error('UIPlayer is destroyed');this.pause();const revision=++this._loadRevision;
    let pack,base,entry,library=this.library;
    if(source?.document){pack=source;base=this.assetBase||document.baseURI;}
    else if(library&&(typeof source!=='string'||library.entries.some(e=>e.id===source||e.key===source||e.name===source))){const result=await library.loadPack(source);pack=result.pack;base=result.assetBase;entry=result.entry;}
    else{
      if(!source)throw Error('UIPlayer requires src or entry');const url=new URL(source,document.baseURI),response=await fetch(url);
      if(!response.ok)throw Error(`UI document: ${response.status} ${url}`);const doc=await response.json();
      if(Array.isArray(doc.assets)){library=await UILibrary.load(url.href);const selected=library.entries.find(e=>e.kind==='prefab'&&e.file&&e.status!=='failed');if(!selected)throw Error('UI library has no exported prefab');const result=await library.loadPack(selected);pack=result.pack;base=result.assetBase;entry=result.entry;}
      else{library=null;pack=doc;base=new URL(pack.resourceBase||'.',url).href;}
    }
    if(revision!==this._loadRevision||this.destroyed)return this;
    this.library=library;this.assetBase=this._explicitAssetBase||base;this.entry=entry;this.session=new UISession(pack,{bindings:this.options.bindings});await this.render();if(revision===this._loadRevision&&!this.destroyed)this.emit('ready',{player:this,entry});return this;
  }
  async controller(selector=this.animators[0]?.index){
    if(!this.session)throw Error('UIPlayer has no document');const session=this.session,revision=this._loadRevision,index=resolveNodeIndex(session.raw,selector);
    if(session.controllers.has(index))return session.controllers.get(index);
    let controller;
    if(this.library)controller=await this.library.loadController(session.raw,index,this.entry);
    else{const ref=component(this.nodes[index],'Animator')?.m_Controller;if(!ref?.clips)throw Error('External UI controllers require a UILibrary');controller={document:ref,resources:resourceURLs(this.session.raw.resources,this.assetBase)};}
    if(this.destroyed||revision!==this._loadRevision||session!==this.session)throw new DOMException('UI document changed while loading its controller','AbortError');
    session.setController(index,controller);return controller;
  }
  async playState(state,{animator=this.animators[0]?.index}={}){this.pause();const controller=await this.controller(animator);this.session.setController(animator,controller).playState(state);await this.render();return this;}
  async selectClip(clip,{animator=this.animators[0]?.index}={}){this.pause();const controller=await this.controller(animator);this.session.setController(animator,controller).selectClip(clip);await this.render();return this;}
  async selectSequence(selector){
    this.pause();const index=resolveNodeIndex(this.session.raw,selector),plan=sequencePlan(this.session.raw,index);
    for(const call of sequenceAnimatorCalls(this.session.raw,plan).filter(c=>c.supported))await this.controller(call.rootIndex);
    this.session.selectSequence(index);await this.render();return this;
  }
  async setParameter(name,value){this.session.setParameter(name,value);await this.render();return this;}
  async edit(node,componentName,field,value){this.session.edit(node,componentName,field,value);await this.render();return this;}
  async applyFixture(fixture,baseURL=this.assetBase){
    for(const patch of fixture.patches||[]){let value=patch.value;if(patch.field==='_previewSource'&&typeof value==='string')value=new URL(value,baseURL).href;this.session.edit(patch.node,patch.component??null,patch.field,value);}
    await this.render();return this;
  }
  async seek(time){this.pause();this.session.seek(time);await this.render();this.emit('timechange',{time:this.time});return this;}
  async reset(){this.pause();this.session.reset();await this.render();return this;}
  async render(){
    if(this.destroyed||!this.session)return null;const revision=++this._revision,pack=this.session.prepare(),renderer=new Renderer(pack,{...this.options,assetBase:this.assetBase});
    const result=renderer.nodes.length?await renderer.render(this.session.root):await renderer.renderAsset();
    if(revision!==this._revision||this.destroyed)return null;this.canvas.width=result.canvas.width;this.canvas.height=result.canvas.height;this.context.drawImage(result.canvas,0,0);this.lastResult=result;
    this.emit('render',{time:this.time,width:result.width,height:result.height,metrics:result.metrics,report:this.report});return result;
  }
  play(){
    if(!this.session?.motion||!this.paused||this.destroyed)return;this.paused=false;const generation=++this._playRevision;let previous=performance.now();this.emit('play',{time:this.time});
    const frame=async now=>{
      if(this.paused||this.destroyed||generation!==this._playRevision)return;this.session.update(Math.max(0,(now-previous)/1000));previous=now;
      try{
        await this.render();if(this.paused||this.destroyed||generation!==this._playRevision)return;const m=this.session.motion;
        if(m?.kind==='clip'&&!m.clip.loopTime&&this.time>=m.clip.stopTime||m?.kind==='state'&&m.runtime.exited||m?.kind==='sequence'&&!m.runtime.plan.sequence._isLoop&&this.time>=m.runtime.plan.duration)this.pause();
        if(!this.paused&&!this.destroyed)this._raf=requestAnimationFrame(frame);
      }catch(error){if(generation===this._playRevision){this.pause();this.emit('error',{error});}}
    };
    this._raf=requestAnimationFrame(frame);
  }
  pause(){this._playRevision++;if(this._raf!==null){cancelAnimationFrame(this._raf);this._raf=null;}const changed=!this.paused;this.paused=true;if(changed)this.emit('pause',{time:this.time});}
  destroy(){if(this.destroyed)return;this.pause();this.destroyed=true;this._revision++;this._loadRevision++;this.session=null;}
}
