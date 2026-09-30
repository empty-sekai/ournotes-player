// Both the standalone page and MoeNotes mount this editor. Rust owns templates, validation and calculation.
import { NOTE_KINDS } from "./catalog.js";
import { applySegmentPreset } from "./replay-preset.js";
const NOTE_KIND=new Map(NOTE_KINDS.flatMap(([kind,types])=>types.map(type=>[type,kind])));
const GRADE_NAMES=["","Miss","Bad","Good","Great","Perfect","Just","Pass"];
const el=(tag,props={},...children)=>{
  const node=document.createElement(tag);
  for(const [key,value]of Object.entries(props)){
    if(key.startsWith("on"))node.addEventListener(key.slice(2),value);
    else if(key in node)node[key]=value;
    else node.setAttribute(key,String(value));
  }
  node.append(...children.flat());return node;
};
export function mountReplayPanel(host,options){
  const {text:t,site,reference,scoreId,power:initialPower=300000,mode:initialMode={kind:"normal"}}=options;
  const root=host.shadowRoot??host.attachShadow({mode:"open"});root.replaceChildren();
  const styles=el("style",{},`
    :host{display:block;color:var(--mn-text);font:inherit;min-width:0;max-width:100%}*{box-sizing:border-box}
    .controls{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:12px 0}label{display:grid;gap:5px;font-size:12px;min-width:0;max-width:100%}
    .controls>*{min-width:0;max-width:100%}button,input,select{min-width:0;max-width:100%}button,.note,summary{overflow-wrap:anywhere}
    button,input,select{font:inherit;color:inherit;background:var(--mn-paper);border:1px solid var(--mn-border);border-radius:8px;padding:6px 9px}
    button{cursor:pointer}button:disabled{opacity:.5;cursor:default}input[type=number]{width:110px}input[type=file]{max-width:220px}
    .note{color:var(--mn-text-muted);font-size:12px;line-height:1.6}.scroll{min-width:0;max-width:100%;max-height:350px;overflow:auto;border:1px solid var(--mn-border);border-radius:10px}
    table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}th,td{padding:7px 10px;text-align:left;border-bottom:1px solid var(--mn-border)}
    th{position:sticky;top:0;background:var(--mn-paper)}.stats{display:flex;gap:15px;flex-wrap:wrap;margin:12px 0}.stats strong{display:block;font-size:20px}
    details{margin:10px 0}summary{cursor:pointer;font-size:13px}.status{overflow-wrap:anywhere}output{display:block}
    .accuracy{display:flex;flex-wrap:wrap;gap:12px 22px;padding:12px;border:1px solid var(--mn-border);border-radius:10px;align-items:center}
    .accuracy label{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.accuracy input{width:130px;padding:0;accent-color:var(--mn-accent,#8bbde5)}.accuracy output{min-width:4ch;font-variant-numeric:tabular-nums}.plan{margin:7px 0}
    .accuracy input[type=number]{width:65px;padding:6px}.segments{overflow:auto;max-width:100%;margin:10px 0}.segments:empty{display:none}.segments table{min-width:660px}.segments input[type=number]{width:58px;padding:5px}.segments .time-input{width:65px}.segments th{position:static;white-space:nowrap}.segments td{padding:6px}.segment-actions{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:10px 0}.segment-actions button{font-size:12px}.segment-actions label{display:flex;align-items:center;gap:6px}.segment-actions input{width:90px}.segments small{white-space:nowrap}
  `);
  const status=el("p",{className:"note status",role:"status"},t.loading),results=el("output",{}),notes=el("div",{className:"scroll"});
  const power=el("input",{type:"number",min:0,step:1000,value:String(initialPower||300000)});
  const seed=el("input",{type:"number",step:1,value:"0"});
  const fps=el("select",{},...[30,60,120].map(n=>el("option",{value:String(n),selected:n===60},`${n} fps`)));
  const mode=el("select",{},el("option",{value:"normal",selected:initialMode.kind==="normal"},t.free),el("option",{value:"fixedSoloGekisou",selected:initialMode.kind!=="normal"},t.fixedRanks));
  const label=(name,input)=>el("label",{},name,input);
  const reset=el("button",{type:"button",disabled:true},t.reset),run=el("button",{type:"button",disabled:true},t.run);
  const importFile=el("input",{type:"file",accept:"application/json,.json",disabled:true}),download=el("button",{type:"button",disabled:true},t.export);
  const great=el("input",{type:"range",min:0,max:100,step:1,value:"0",disabled:true,"aria-label":t.greatShare}),just=el("input",{type:"range",min:0,max:100,step:1,value:"100",disabled:true,"aria-label":t.justShare});
  const greatValue=el("output",{},"0%"),justValue=el("output",{},"100%"),plan=el("p",{className:"note plan"});
  const good=el("input",{type:"number",min:0,max:100,step:1,value:"0",disabled:true,"aria-label":"Good %"}),bad=el("input",{type:"number",min:0,max:100,step:1,value:"0",disabled:true,"aria-label":"Bad %"}),miss=el("input",{type:"number",min:0,max:100,step:1,value:"0",disabled:true,"aria-label":"Miss %"});
  const planSeed=el("input",{type:"number",min:0,max:4294967295,step:1,value:"0",disabled:true}),generate=el("button",{type:"button",disabled:true},t.generate);
  const segmentTable=el("div",{className:"segments"}),segmentActions=el("div",{className:"segment-actions"});
  const notesDetail=el("details",{ontoggle:()=>{if(notesDetail.open&&request)renderNotes();}},el("summary",{},t.editNotes),notes);
  root.append(styles,el("p",{className:"note"},t.hint),el("div",{className:"controls"},label(t.power,power),label(t.seed,seed),label(t.clock,fps),label(t.mode,mode),reset,run),el("div",{className:"accuracy"},el("span",{className:"note"},t.wholeSong),el("label",{},t.greatShare,great,greatValue),el("label",{},t.justShare,just,justValue),label("Good %",good),label("Bad %",bad),label("Miss %",miss)),segmentActions,segmentTable,el("p",{className:"note"},t.presetHint),plan,status,results,notesDetail,el("details",{},el("summary",{},t.advanced),el("p",{className:"note"},t.advancedHint),el("div",{className:"controls"},label(t.import,importFile),download)));
  let request,description,justTypes=[],presetActive=true,disposed=false,nextId=0,ready=false,templateFps=60,fatal=false;
  let segments=[],planValid=true,busy=false;
  const savedModes=new Map([["normal",{kind:"normal"}],["fixedSoloGekisou",{kind:"fixedSoloGekisou",ranks:initialMode.ranks??[1,1,1]}]]);
  const pending=new Map();
  const workerUrl=URL.createObjectURL(new Blob([`import ${JSON.stringify(new URL("./replay-worker.js",import.meta.url).href)};`],{type:"text/javascript"}));
  const worker=new Worker(workerUrl,{type:"module"});URL.revokeObjectURL(workerUrl);
  worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;pending.delete(data.id);data.error?task.reject(new Error(data.error)):task.resolve(data.result);};
  const fail=error=>{if(!disposed){status.textContent=`${t.error}: ${String(error?.message??error)}`;if(!busy){run.disabled=!request||!planValid;reset.disabled=false;}}};
  worker.onerror=error=>{
    fatal=true;ready=false;for(const task of pending.values())task.reject(new Error(error.message));pending.clear();
    fail(error);request=undefined;run.disabled=reset.disabled=importFile.disabled=download.disabled=great.disabled=just.disabled=true;
  };
  const call=(op,...args)=>new Promise((resolve,reject)=>{if(fatal){reject(new Error(t.error));return;}const id=++nextId;pending.set(id,{resolve,reject});worker.postMessage({id,op,args});});
  const controlsToRequest=()=>{
    request.power=Number(power.value);request.seed=Number(seed.value);
    return request;
  };
  const invalidate=()=>{results.replaceChildren();if(request)status.textContent=t.ready;};
  power.oninput=seed.oninput=invalidate;
  function beginWork(){if(busy||fatal||disposed)return false;busy=true;for(const input of root.querySelectorAll("input,select,button"))input.disabled=true;return true;}
  function endWork(){
    busy=false;if(disposed||fatal)return;
    power.disabled=seed.disabled=mode.disabled=false;fps.disabled=fps.value==="imported";
    reset.disabled=false;run.disabled=!request||!planValid;importFile.disabled=!ready;download.disabled=!request;
    renderNotes();
  }
  function updatePlan(){
    if(!request)return;
    const counts={};for(const frame of request.frames)for(const note of frame.judgements)counts[note.judgement]=(counts[note.judgement]??0)+1;
    plan.textContent=[5,6,4,3,2,1].map(grade=>`${GRADE_NAMES[grade]} ${counts[grade]??0}`).join(" · ");
    if(busy)return;
    const raw=request.rawRuntime!=null||request.frames.some(frame=>frame.judgements.some(note=>note.rawResult!=null));
    for(const input of [great,just,good,bad,miss,planSeed,generate,...segmentActions.querySelectorAll("button"),...segmentTable.querySelectorAll("input,button")])input.disabled=!ready||raw;
    just.disabled=!ready||raw||request.mode.kind==="normal"||!description.missions.includes(3);
    for(const input of segmentTable.querySelectorAll('[data-grade="just"]'))input.disabled=just.disabled;
    if(raw)plan.append(` · ${t.rawPreset}`);
  }
  function applyPreset(){
    if(!request||fatal||busy)return;
    try{
      const base={startMs:null,endMs:null,great:Number(great.value)/100,good:Number(good.value)/100,bad:Number(bad.value)/100,miss:Number(miss.value)/100,just:Number(just.value)/100};
      if([base,...segments].some(s=>s.great+s.good+s.bad+s.miss>1+1e-12))throw new Error(t.probabilityTotal);
      applySegmentPreset(request,description,justTypes,[base,...segments],Number(planSeed.value));
      planValid=true;presetActive=true;greatValue.textContent=`${great.value}%`;justValue.textContent=`${just.value}%`;renderNotes();invalidate();run.disabled=false;
    }catch(error){planValid=false;fail(error);run.disabled=true;results.replaceChildren();}
  }
  great.oninput=()=>{greatValue.textContent=`${great.value}%`;};just.oninput=()=>{justValue.textContent=`${just.value}%`;};
  great.onchange=just.onchange=applyPreset;
  good.oninput=bad.oninput=miss.oninput=planSeed.oninput=applyPreset;generate.onclick=applyPreset;
  function renderSegments(){
    const probability=(segment,key)=>{
      const input=el("input",{type:"number",min:0,max:100,step:1,value:String(Math.round(segment[key]*100)),"data-grade":key,"aria-label":`${segment.name} ${key} %`,oninput:()=>{segment[key]=Number(input.value)/100;applyPreset();}});return input;
    };
    const time=(segment,key)=>{const input=el("input",{type:"number",className:"time-input",min:0,step:.1,value:String(segment[key]/1000),"aria-label":`${segment.name} ${key==="startMs"?t.start:t.end}`,onchange:()=>{segment[key]=Math.round(Number(input.value)*1000);applyPreset();}});return input;};
    segmentTable.replaceChildren(...(segments.length?[el("table",{},el("thead",{},el("tr",{},...[t.segment,t.start,t.end,"Great %","Good %","Bad %","Miss %","Just %",""].map(name=>el("th",{},name)))),el("tbody",{},...segments.map(segment=>el("tr",{},el("td",{},el("small",{},segment.name)),el("td",{},time(segment,"startMs")),el("td",{},time(segment,"endMs")),...["great","good","bad","miss","just"].map(key=>el("td",{},probability(segment,key))),el("td",{},el("button",{type:"button","aria-label":`${t.remove} ${segment.name}`,onclick:()=>{segments=segments.filter(s=>s!==segment);renderSegments();applyPreset();}},"×"))))))]:[]));
    updatePlan();
  }
  function addSegment(name,startMs,endMs){
    segments.push({name,startMs,endMs,great:Number(great.value)/100,good:Number(good.value)/100,bad:Number(bad.value)/100,miss:Number(miss.value)/100,just:Number(just.value)/100});renderSegments();applyPreset();
  }
  function setupSegments(){
    segmentActions.replaceChildren(label(t.planSeed,planSeed),generate,...description.fevers.map(([start,end],i)=>el("button",{type:"button",onclick:()=>addSegment(`${t.range} ${i+1}`,start,end)},`+ ${t.range} ${i+1}`)),el("button",{type:"button",onclick:()=>addSegment(`${t.segment} ${segments.length+1}`,0,Math.min(30000,request.musicLengthMs))},`+ ${t.customSegment}`));
    renderSegments();
  }
  mode.onchange=()=>{if(request&&savedModes.has(mode.value)){request.mode=structuredClone(savedModes.get(mode.value));presetActive?applyPreset():updatePlan();invalidate();}};
  function renderNotes(){
    updatePlan();if(!notesDetail.open){notes.replaceChildren();return;}
    const byId=new Map(description.notes.map(n=>[n.noteId,n]));
    const body=el("tbody",{});
    for(const frame of request.frames)for(const judgement of frame.judgements){
      const note=byId.get(judgement.noteId);if(!note)continue;
      if(note.defaultJudgement===7)continue;
      const select=el("select",{disabled:busy||judgement.rawResult!=null,"aria-label":`${t.judgement} ${judgement.noteId}`,onchange:()=>{if(busy)return;judgement.judgement=Number(select.value);presetActive=false;planValid=true;run.disabled=false;updatePlan();invalidate();}});
      for(const grade of note.defaultJudgement===7?[7]:[5,6,4,3,2,1])select.append(el("option",{value:String(grade),selected:judgement.judgement===grade},GRADE_NAMES[grade]));
      body.append(el("tr",{},el("td",{},String(judgement.noteId)),el("td",{},`${note.noteMs} ms`),el("td",{},options.noteKindLabels?.[NOTE_KIND.get(note.opType)]??String(note.opType)),el("td",{},select)));
    }
    notes.replaceChildren(el("table",{},el("thead",{},el("tr",{},...[t.note,t.time,t.type,t.judgement].map(name=>el("th",{},name)))),body));
    updatePlan();
  }
  async function restore(){
    if(!beginWork())return;
    reset.disabled=run.disabled=importFile.disabled=great.disabled=just.disabled=true;ready=false;status.textContent=t.loading;results.replaceChildren();
    if(fps.value!=="imported")templateFps=Number(fps.value);fps.value=String(templateFps);fps.disabled=false;
    if(!["normal","fixedSoloGekisou"].includes(mode.value))mode.value=initialMode.kind==="normal"?"normal":"fixedSoloGekisou";
    try{request=await call("template",scoreId,Number(power.value),templateFps);if(disposed)return;request.mode=structuredClone(savedModes.get(mode.value));controlsToRequest();ready=true;setupSegments();busy=false;applyPreset();download.disabled=false;}
    catch(error){fail(error);}finally{endWork();}
  }
  reset.onclick=restore;fps.onchange=restore;
  run.onclick=async()=>{
    if(!beginWork())return;
    run.disabled=importFile.disabled=true;ready=false;updatePlan();status.textContent=t.calculating;
    try{
      const result=await call("run",JSON.stringify(controlsToRequest()));if(disposed)return;
      if(!result.complete)throw new Error(t.incomplete);
      const stat=(name,value)=>el("div",{},el("span",{className:"note"},name),el("strong",{},Number(value).toLocaleString()));
      results.replaceChildren(el("div",{className:"stats"},stat(t.score,result.score),stat(t.frameScore,result.frameScore),stat(t.life,result.life),stat(t.combo,result.combo)),el("p",{className:"note"},["just","perfect","great","good","bad","miss"].map(k=>`${k.toUpperCase()} ${result.judgements[k]}`).join(" · ")));
      if(result.ranges.length)results.append(el("div",{className:"scroll"},el("table",{},el("thead",{},el("tr",{},...[t.range,t.combo,t.just,t.luck].map(x=>el("th",{},x)))),el("tbody",{},...result.ranges.map((range,i)=>el("tr",{},...[i+1,range.maxCombo,range.justCount,range.luckPoints].map(x=>el("td",{},String(x)))))))));
      status.textContent=t.complete;
    }catch(error){fail(error);}finally{ready=true;endWork();}
  };
  importFile.onchange=async()=>{
    if(!beginWork())return;
    try{
      const file=importFile.files?.[0];if(!file)return;
      const imported=JSON.parse(await file.text());
      if(imported.format!=="ournotes.replay/1"||imported.scoreId!==scoreId)throw new Error(t.wrongChart);
      if(imported.complete===false)throw new Error(t.incomplete);
      const known=new Set(description.notes.map(note=>note.noteId));
      if(!["normal","soloGekisou","fixedSoloGekisou","externalGekisou"].includes(imported.mode?.kind)||!Number.isFinite(imported.power)||!Number.isInteger(imported.seed)||!Number.isInteger(imported.musicLengthMs)||!Number.isInteger(imported.scoreMusicLengthMs)||!Array.isArray(imported.frames)||!imported.frames.length||imported.frames.some(frame=>!Number.isInteger(frame?.timeMs)||!Number.isFinite(frame.deltaSeconds)||!Array.isArray(frame.judgements)||frame.judgements.some(note=>!known.has(note?.noteId)||!Number.isInteger(note.judgement)||note.judgement<1||note.judgement>7||!Number.isInteger(note.judgementTimeMs))))throw new Error(t.wrongChart);
      request=imported;presetActive=false;planValid=true;power.value=String(request.power);seed.value=String(request.seed);
      savedModes.set(request.mode.kind,structuredClone(request.mode));
      if(![...mode.options].some(option=>option.value===request.mode.kind))mode.append(el("option",{value:request.mode.kind},t.importedMode));
      mode.value=request.mode.kind;
      if(![...fps.options].some(option=>option.value==="imported"))fps.append(el("option",{value:"imported"},t.importedClock));
      fps.value="imported";fps.disabled=true;
      renderNotes();status.textContent=t.ready;results.replaceChildren();run.disabled=false;download.disabled=false;
    }catch(error){fail(error);}finally{endWork();}
  };
  download.onclick=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(controlsToRequest(),null,2)],{type:"application/json"}));
    const link=el("a",{href:url,download:`live-${scoreId}.json`});link.click();URL.revokeObjectURL(url);
  };
  (async()=>{try{const metadata=await call("init",site,reference);justTypes=metadata.justJudgementTypes;description=await call("describeChart",scoreId);await restore();}catch(error){fail(error);}})();
  return()=>{disposed=true;worker.terminate();for(const task of pending.values())task.reject(new Error(t.error));pending.clear();root.replaceChildren();};
}
