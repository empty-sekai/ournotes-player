import {UILibrary,UIPlayer} from '../../src/ui/index.js';

const $=s=>document.querySelector(s),canvas=$('#canvas');
let library=null,player=null,entries=[],generation=0;
canvas.hidden=true;
const option=(text,value)=>{const o=document.createElement('option');o.textContent=text;o.value=value;return o;};
const fill=(select,label,rows)=>{select.replaceChildren(option(label,''),...rows.map(r=>option(r.name,r.value)));select.disabled=!rows.length;};
const error=e=>{$('#status').textContent=e.message||String(e);};
const run=fn=>async()=>{try{await fn();refresh();}catch(e){error(e);}};

function refresh(){
  if(!player)return;
  const motion=player.session?.motion;$('#play').disabled=!motion;$('#time').disabled=!motion;$('#play').textContent=player.paused?'Play':'Pause';
  $('#time').max=Math.max(1,player.duration,player.time);$('#time').value=player.time;$('#seconds').value=player.time.toFixed(3)+' s';
  $('#parameters').hidden=motion?.kind!=='state';$('#diagnostics').textContent=JSON.stringify(player.report,null,2);
  const result=player.lastResult;
  if(result)$('#status').textContent=`${Math.round(result.width||canvas.width)} × ${Math.round(result.height||canvas.height)} · ${player.nodes.length} nodes · ${player.report?.diagnostics.length||0} motion diagnostics`;
}

function list(){
  const query=$('#search').value.trim().toLowerCase(),visible=entries.filter(e=>(e.name+' '+(e.key||'')).toLowerCase().includes(query));
  $('#assets').replaceChildren(...visible.map(e=>option(e.name,e.id)));$('#count').textContent=visible.length+' prefabs';
}

async function select(id){
  const revision=++generation,entry=library.find(id);player?.destroy();player=null;canvas.hidden=true;$('#empty').hidden=false;$('#empty').textContent='Loading prefab…';
  $('#name').textContent=entry.name;$('#key').textContent=entry.key||entry.file;$('#parameters').replaceChildren();
  fill($('#state'),'State',[]);fill($('#clip'),'Clip',[]);$('#play').disabled=$('#time').disabled=$('#reset').disabled=true;
  const loaded=await UIPlayer.create(canvas,{library,entry,showHidden:$('#hidden').checked,bounds:$('#bounds').checked});
  if(revision!==generation){loaded.destroy();return;}player=loaded;canvas.hidden=false;$('#empty').hidden=true;$('#reset').disabled=false;
  fill($('#animator'),'Animator',player.animators.map(a=>({name:a.name+' · '+a.path.split('/').at(-1),value:a.index})));
  fill($('#sequence'),'Sequence',player.sequences.map(a=>({name:a.name,value:a.index})));
  for(const event of ['render','play','pause'])player.addEventListener(event,refresh);player.addEventListener('error',e=>error(e.detail.error));refresh();
}

$('#open').onsubmit=async e=>{
  e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;
  try{library=await UILibrary.load($('#source').value);entries=library.entries.filter(e=>['prefab','embedded'].includes(e.kind)&&e.file&&e.status!=='failed');list();if(!entries.length)throw Error('No exported prefabs in this library');$('#assets').value=entries[0].id;await select(entries[0].id);}catch(e){error(e);}finally{button.disabled=false;}
};
$('#search').oninput=list;$('#assets').onchange=run(()=>select($('#assets').value));
$('#animator').onchange=run(async()=>{
  $('#parameters').replaceChildren();fill($('#state'),'State',[]);fill($('#clip'),'Clip',[]);await player.reset();$('#sequence').value='';if(!$('#animator').value)return;
  const exported=await player.controller(Number($('#animator').value)),controller=exported.document,machine=controller.stateMachines?.[controller.layers?.[0]?.stateMachine||0];
  fill($('#state'),'State',(machine?.states||[]).map((s,i)=>({name:s.name,value:i})));fill($('#clip'),'Clip',(controller.clips||[]).map((c,i)=>({name:c.clip,value:i})));
  for(const parameter of controller.parameters||[]){
    if(parameter.type===9){const button=document.createElement('button');button.textContent=parameter.name;button.onclick=run(()=>player.setParameter(parameter.name,true));$('#parameters').append(button);}
    else{const label=document.createElement('label');label.textContent=parameter.name;const input=document.createElement('input');input.type=parameter.type===4?'checkbox':'number';input.step=parameter.type===3?'1':'any';input.value='0';input.onchange=run(()=>player.setParameter(parameter.name,input.type==='checkbox'?input.checked:Number(input.value)));label.append(input);$('#parameters').append(label);}
  }
});
$('#state').onchange=run(async()=>{if($('#state').value==='')return;await player.playState(Number($('#state').value),{animator:Number($('#animator').value)});$('#clip').value=$('#sequence').value='';});
$('#clip').onchange=run(async()=>{if($('#clip').value==='')return;await player.selectClip(Number($('#clip').value),{animator:Number($('#animator').value)});$('#state').value=$('#sequence').value='';});
$('#sequence').onchange=run(async()=>{if($('#sequence').value==='')return;await player.selectSequence(Number($('#sequence').value));$('#state').value=$('#clip').value='';});
$('#play').onclick=()=>{if(!player)return;player.paused?player.play():player.pause();refresh();};
$('#time').oninput=run(()=>player.seek(Number($('#time').value)));$('#reset').onclick=run(async()=>{await player.reset();$('#state').value=$('#clip').value=$('#sequence').value='';});
for(const [id,key] of [['hidden','showHidden'],['bounds','bounds']])$('#'+id).onchange=run(async()=>{if(player){player.options[key]=$('#'+id).checked;await player.render();}});

const src=new URL(location.href).searchParams.get('src');if(src){$('#source').value=new URL(src,location.href).href;$('#open').requestSubmit();}
