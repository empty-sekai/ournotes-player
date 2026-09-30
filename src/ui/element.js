import {UIPlayer} from './player.js';

const Base=globalThis.HTMLElement||class {};

export class OurnotesUIElement extends Base {
  static get observedAttributes(){return ['src','entry','show-hidden','bounds'];}
  constructor(){
    super();this.attachShadow({mode:'open'});const style=document.createElement('style');style.textContent=':host{display:block;position:relative;contain:content}:host([hidden]){display:none}canvas{max-width:100%;max-height:100%;object-fit:contain}';
    this.canvas=document.createElement('canvas');this.shadowRoot.append(style,this.canvas);this.player=null;this._generation=0;this._resetReady();
  }
  get src(){return this.getAttribute('src')||'';}set src(value){this.setAttribute('src',value);}
  get entry(){return this.getAttribute('entry')||'';}set entry(value){if(value)this.setAttribute('entry',value);else this.removeAttribute('entry');}
  get ready(){return this._ready;}
  get time(){return this.player?.time||0;}
  connectedCallback(){clearTimeout(this._disposeTimer);if(this.src&&!this.player&&!this._loading)this._load();}
  disconnectedCallback(){this._disposeTimer=setTimeout(()=>{if(!this.isConnected){this._generation++;this.player?.destroy();this.player=null;this._loading=false;if(!this._settled){this._settled=true;this._reject(new DOMException('UI element disconnected','AbortError'));}}},0);}
  attributeChangedCallback(name,old,value){
    if(old===value)return;if(name==='src'||name==='entry'){if(this.isConnected)this._load();}
    else if(this.player){this.player.options[name==='show-hidden'?'showHidden':'bounds']=value!==null;this.player.render().catch(error=>this.dispatchEvent(new CustomEvent('error',{detail:{error}})));}
  }
  _resetReady(){if(this._ready&&!this._settled)this._reject(new DOMException('UI load superseded','AbortError'));this._settled=false;this._ready=new Promise((resolve,reject)=>{this._resolve=resolve;this._reject=reject;});this._ready.catch(()=>{});}
  async _load(){
    const generation=++this._generation;this.player?.destroy();this.player=null;if(this._settled||this._loading)this._resetReady();this._loading=true;
    try{
      let player;
      if(this.entry){const {UILibrary}=await import('./library.js'),library=await UILibrary.load(this.src);player=await UIPlayer.create(this.canvas,{library,entry:this.entry,showHidden:this.hasAttribute('show-hidden'),bounds:this.hasAttribute('bounds')});}
      else player=await UIPlayer.create(this.canvas,{src:this.src,showHidden:this.hasAttribute('show-hidden'),bounds:this.hasAttribute('bounds')});
      if(generation!==this._generation||!this.isConnected){player.destroy();return;}
      this.player=player;for(const event of ['render','play','pause','timechange','error'])player.addEventListener(event,e=>this.dispatchEvent(new CustomEvent(event,{detail:e.detail})));
      this._settled=true;this._resolve(player);this.dispatchEvent(new CustomEvent('ready',{detail:{player}}));
    }catch(error){if(generation===this._generation){this._settled=true;this._reject(error);this.dispatchEvent(new CustomEvent('error',{detail:{error}}));}}
    finally{if(generation===this._generation)this._loading=false;}
  }
  async playState(state,options){return (await this.ready).playState(state,options);}
  async selectClip(clip,options){return (await this.ready).selectClip(clip,options);}
  async selectSequence(node){return (await this.ready).selectSequence(node);}
  async seek(time){return (await this.ready).seek(time);}
  play(){this.player?.play();}pause(){this.player?.pause();}
}

export function defineOurnotesUI(name='ournotes-ui'){if(!customElements.get(name))customElements.define(name,OurnotesUIElement);return OurnotesUIElement;}
