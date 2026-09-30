import {UILibrary,UISession,UIPlayer,OurnotesUIElement,defineOurnotesUI,type UIPack,type UIReport} from 'ournotes-player/ui';
import 'ournotes-player/ui/element';

const source: UIPack={document:{nodes:[]},resources:{}};
const session=new UISession(source);
session.edit(0,null,'active',false).seek(.2).reset();
const library=new UILibrary({assets:[]},'https://example.invalid/');
async function load(host: HTMLElement){
  const player=await UIPlayer.create(host,{library,entry:'example'});
  const report: UIReport|null=player.report;
  await player.edit('root','CanvasGroup','m_Alpha',.5);
  await player.playState('Open',{animator:0});await player.selectSequence(1);await player.seek(.1);
  player.play();player.pause();player.destroy();return report;
}
const element: OurnotesUIElement=document.createElement('ournotes-ui');
element.src='pack.json';element.entry='root';void element.ready;defineOurnotesUI();void source;void load;
