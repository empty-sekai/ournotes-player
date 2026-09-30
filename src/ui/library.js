import {component} from './runtime.js';
const defaultFetch=(...args)=>globalThis.fetch(...args);

export class UILibrary {
  static async load(src,{fetch:fetcher=defaultFetch,signal}={}){
    const url=new URL(src,globalThis.document?.baseURI||undefined),response=await fetcher(url.href,{signal});
    if(!response.ok)throw Error(`UI library: ${response.status} ${url}`);
    const index=await response.json();if(!Array.isArray(index.assets))throw Error('UI library index requires assets');
    const library=new UILibrary(index,new URL('.',url).href,fetcher);
    if(!Array.isArray(index.controllers)){
      const extra=await fetcher(new URL('dependency-controllers.json',library.baseURL).href,{signal});
      if(extra.ok)library.controllers.push(...(await extra.json()).controllers||[]);else if(extra.status!==404)throw Error(`UI controllers: ${extra.status}`);
    }
    library.controllers=[...new Map(library.controllers.map(e=>[e.id||e.file,e])).values()];return library;
  }
  constructor(index,baseURL,fetcher=defaultFetch){
    this.index=index;this.baseURL=baseURL;this.fetcher=(...args)=>fetcher(...args);this.cache=new Map();
    this.entries=[...index.assets,...(index.embedded||[]).map(e=>({...e,kind:'embedded'}))];
    this.controllers=[...new Map([...index.assets.filter(e=>e.kind==='controller'),...(index.controllers||[])].map(e=>[e.id||e.file,e])).values()];
  }
  find(key){
    if(key&&typeof key==='object'&&key.file)return key;
    const exact=this.entries.filter(e=>e.id===key||e.key===key);if(exact.length===1)return exact[0];if(exact.length>1)throw Error('Ambiguous UI entry: '+key);
    const named=this.entries.filter(e=>e.name===key);if(named.length===1)return named[0];
    throw Error((named.length>1?'Ambiguous UI entry: ':'UI entry not found: ')+key);
  }
  async loadPack(entry,{signal}={}){
    entry=this.find(entry);if(!entry.file)throw Error(entry.error||'UI entry has no exported file');
    const url=new URL(entry.file,this.baseURL).href;
    const request=async()=>{const response=await this.fetcher(url,{signal});if(!response.ok)throw Error(`UI pack: ${response.status} ${url}`);const pack=await response.json();return {pack,assetBase:pack.resourceBase?new URL(pack.resourceBase,url).href:this.baseURL};};
    if(!signal&&!this.cache.has(url))this.cache.set(url,request().catch(error=>{this.cache.delete(url);throw error;}));
    const result=await (signal?request():this.cache.get(url));return {...result,pack:structuredClone(result.pack),entry};
  }
  async loadController(pack,nodeIndex,entry,{signal}={}){
    const node=pack.document.nodes[nodeIndex],ref=component(node,'Animator')?.m_Controller;if(!ref)throw Error('UI node has no Animator');
    const name=ref.name||ref.controller,candidates=this.controllers.filter(e=>ref.id?e.id===ref.id:e.name===name);
    const matches=candidates.filter(e=>e.bindings?.some(b=>b.path===node.path&&b.source_key===entry?.key));
    const selected=matches.length===1?matches[0]:candidates.length===1?candidates[0]:null;
    if(selected){const result=await this.loadPack(selected,{signal});return {document:result.pack.document,resources:resourceURLs(result.pack.resources,result.assetBase)};}
    if(ref.clips)return {document:ref,resources:pack.resources};
    throw Error(candidates.length>1?'Ambiguous UI controller: '+name:'UI controller not exported: '+name);
  }
}

export function resourceURLs(resources,baseURL){
  const result={...resources};for(const kind of ['textures','fonts'])result[kind]=Object.fromEntries(Object.entries(resources?.[kind]||{}).map(([key,file])=>[key,new URL(file,baseURL).href]));
  if(resources?.fontMetrics)result.fontMetrics=new URL(resources.fontMetrics,baseURL).href;
  if(resources?.fontMetricsByAsset)result.fontMetricsByAsset=Object.fromEntries(Object.entries(resources.fontMetricsByAsset).map(([name,file])=>[name,new URL(file,baseURL).href]));return result;
}
