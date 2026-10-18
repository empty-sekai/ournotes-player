import {AssetStore} from 'ournotes-player';
import {UILibrary,UISession,UIPlayer,OurnotesUIElement,defineOurnotesUI,cameraProjection,UIPack,type UIReport} from 'ournotes-player/ui';
import 'ournotes-player/ui/element';

const source=new UIPack(new AssetStore(),{format:'nnnotes.ui-pack/1',key:'example',roots:[],prefabs:[],controllers:[],entries:[],bindings:{},shaders:{}});
source.browserFontFamily='sans-serif';
const session=new UISession(source);
session.edit(0,null,'active',false).seek(.2).reset();
const library=new UILibrary({format:'nnnotes.ui-library/1',assets:[],embedded:[],controllers:[]},'https://example.invalid/');
async function load(host: HTMLElement){
  const projection=cameraProjection({orthographic:false,'field of view':20,'near clip plane':.3},{m_RenderMode:1,m_PlaneDistance:100},[1920,1080]);
  const player=await UIPlayer.create(host,{library,entry:'example',projection,framing:'content'});
  const report: UIReport|null=player.report;
  await player.edit('root','CanvasGroup','m_Alpha',.5);
  await player.playState('Open',{animator:0});await player.selectSequence(1);await player.seek(.1);
  const result=await player.render();if(result&&'regions' in result){const corner=result.regions.root[0];const x=(corner.x-result.bounds.minX+result.padding)*result.scale;void x;}
  player.play();player.pause();player.destroy();return report;
}
const element: OurnotesUIElement=document.createElement('ournotes-ui');
element.src='pack.json';element.entry='root';void element.ready;defineOurnotesUI();void source;void load;
