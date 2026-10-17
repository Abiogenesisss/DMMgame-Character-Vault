import { StoryEngine, StoryAudio } from './story-engine.ts';
import { HoldForward } from './hold-forward.ts';
import { loadNativeUi } from './native-ui.ts';
import { Player } from './spine-player.ts';
import { MuvStoryUi } from './story-ui.ts';
import { animation, FACES, plain, seconds } from './story-format.ts';
import { StoryControls } from '../../../app/viewer/story-controls.ts';
const node=(tag,cls,text?: any)=>{const el=document.createElement(tag);el.className=cls;if(text)el.textContent=text;return el;};
export class MuvStoryPlayer{
  declare token: any;
  declare actors: any;
  declare animations: any;
  declare auto: any;
  declare skip: any;
  declare audio: any;
  declare stage: any;
  declare background: any;
  declare motion: any;
  declare actorHost: any;
  declare fade: any;
  declare error: any;
  declare position: any;
  declare observer: any;
  declare hold: any;
  declare engine: any;
  declare ui: any;
  declare fast: any;
  declare click: any;
  declare key: any;
  declare visibility: any;
  declare story: any;
  declare asset: any;
  declare positionKey: any;
  declare autoTimer: any;
  declare typing: any;
  declare typeTimer: any;
  declare fullText: any;
  declare cg: any;
  declare bgKey: any;
  declare motionKey: any;
  declare scene: any;
  declare desiredAudio: any;
  declare current: any;
  declare assetRoot: any;
  declare motionSpeed: any;
  declare onError: any;
  declare container: any;
  declare toolbar: StoryControls;

  constructor(container,{asset,assetRoot,positionKey,onError=()=>{}}){
    Object.assign(this,{container,asset,assetRoot,positionKey,onError});this.token=0;this.actors=new Map();this.animations=new Set<string>();this.auto=false;this.skip=false;
    this.audio=new StoryAudio({asset});this.stage=node('div','muv-story-stage');this.stage.tabIndex=0;this.stage.setAttribute('aria-label','Muv-Luv 剧情，点击或按空格继续');
    this.background=node('img','muv-story-background');this.background.alt='剧情背景';this.background.hidden=true;this.motion=node('div','muv-story-cg');this.actorHost=node('div','muv-story-actors');this.fade=node('div','muv-story-fade');this.error=node('div','muv-story-error');this.error.hidden=true;this.error.setAttribute('role','alert');
    this.stage.append(this.background,this.motion,this.actorHost,this.fade,this.error);
    this.position=node('span','muv-story-position');
    this.toolbar=new StoryControls(container,{previous:()=>this.engine?.previous(),next:()=>this.next(),restart:()=>this.restart()},{className:'muv-story-footer',position:this.position,onError:this.onError});container.replaceChildren(this.stage,this.toolbar.element);
    this.observer=new ResizeObserver(()=>{this.stage.style.setProperty('--native-unit',this.stage.clientWidth/1920+'px');});this.observer.observe(this.stage);
    this.hold=new HoldForward(this.stage,{canStart:e=>!!this.engine&&!this.ui?.modal&&!this.ui?.logOpen&&!this.ui?.hidden&&!e.target.closest('[role=button],button,input'),onChange:fast=>{this.fast=fast;this.engine?.setFastForward(fast||this.skip);this.setRate();if(fast)this.audio.stop('voice');},onAdvance:()=>this.next()});
    this.click=e=>{if(!e.target.closest('[role=button],button,input')&&!this.ui?.modal&&!this.ui?.logOpen)this.next();};this.stage.addEventListener('click',this.click);
    this.key=e=>{if(e.target.closest('[role=button],button,input')||this.ui?.modal||this.ui?.logOpen)return;if(e.code==='Space'||e.key==='ArrowRight'){e.preventDefault();this.next();}else if(e.key==='ArrowLeft'){e.preventDefault();this.engine?.previous();}};this.stage.addEventListener('keydown',this.key);
    this.visibility=()=>{if(document.hidden){this.audio.pauseAll();this.clearAuto();}else{this.audio.resumeAll();this.queueAuto();}};document.addEventListener('visibilitychange',this.visibility);
  }
  async load(story){if(story.programVersion!==2)throw new Error('请更新此角色的完整 CG 剧情。');if(!story.ui)throw new Error('请先点击“下载播放器 UI”补齐本地界面。');if(story.complete===false)throw new Error('本章脚本或素材尚未拉完整，请更新完整 CG 剧情。');this.story=story;const token=this.token,data=await loadNativeUi(story.ui,this.asset);if(token!==this.token)return;this.ui=new MuvStoryUi(this,data);
    this.engine=new StoryEngine(story.program,{reset:()=>this.reset(),stop:()=>this.stopPlayback(),execute:(a,o)=>this.execute(a,o),reveal:()=>this.reveal(),stopVoice:()=>this.audio.stop('voice')},{onLine:(_a,line)=>{localStorage.setItem(this.positionKey,String(line));this.toolbar.previous.disabled=line===0;this.toolbar.next.disabled=false;this.toolbar.restart.disabled=false;this.position.textContent=(line+1)+' / '+story.program.dialogue;this.queueAuto();},onEnd:()=>{this.auto=false;this.skip=false;this.toolbar.next.disabled=true;this.position.textContent='本章播放完毕';},onError:e=>this.fail(e)});
    const bookmark=Number(localStorage.getItem(this.positionKey));await this.engine.start({line:Number.isInteger(bookmark)&&bookmark>=0&&bookmark<story.program.dialogue?bookmark:0});this.stage.focus({preventScroll:true});
  }
  clearAuto(){clearTimeout(this.autoTimer);this.autoTimer=null;}
  queueAuto(){this.clearAuto();if(!this.engine?.waiting||this.ui?.modal||this.ui?.logOpen||document.hidden||(!this.auto&&!this.skip))return;this.autoTimer=setTimeout(()=>{if(this.typing||this.audio.voicePlaying&&!this.skip)this.queueAuto();else this.next();},this.skip?90:600);}
  next(){if(this.ui?.hidden){this.ui.hide(false);return;}this.engine?.next();}
  restart(){if(!this.engine)return;this.ui.setAuto(false);this.hold.stop();this.fast=false;this.setSkip(false);this.ui.close(false);this.ui.closeLog();this.ui.hide(false);return this.engine.start();}
  reveal(){if(!this.typing)return false;clearTimeout(this.typeTimer);this.typing=false;this.ui.text(this.fullText,true);return true;}
  type(text,instant){clearTimeout(this.typeTimer);this.fullText=text;this.typing=!instant&&!this.fast&&!this.skip&&text.length>0;let at=this.typing?0:text.length;const token=this.token;const tick=()=>{if(token!==this.token)return;this.ui.text(text.slice(0,at),at>=text.length);if(at>=text.length){this.typing=false;return;}at++;this.typeTimer=setTimeout(tick,[55,32,12][this.ui.config.speed]||32);};tick();}
  wait(time){return time>0?this.engine.delay(time):Promise.resolve();}
  setSkip(value){this.skip=value;this.engine?.setFastForward(value||this.fast);this.setRate();if(value){this.audio.stop('voice');this.reveal();}this.queueAuto();}
  animate(host,frames,duration,options: any={}){if(!host.animate||!(duration>0))return;const animation=host.animate(frames,{duration:duration/(this.fast||this.skip?8:1),fill:'none',...options});this.animations.add(animation);animation.finished.catch(()=>{}).finally(()=>this.animations.delete(animation));return animation;}
  stopPlayback(){this.token++;this.clearAuto();clearTimeout(this.typeTimer);this.typing=false;for(const animation of this.animations)animation.cancel();this.animations.clear();this.audio.stopAll();}
  async reset(){this.stopPlayback();this.cg?.destroy();this.cg=null;for(const actor of this.actors.values()){actor.player.destroy();actor.host.remove();}this.actors.clear();this.background.hidden=true;this.fade.style.opacity='0';this.bgKey=null;this.motionKey=null;this.scene=null;this.desiredAudio={};this.error.hidden=true;}
  file(prefix,id){if(!id)return null;return this.story.resources[prefix+'/'+id]||this.story.resources[prefix+'/'+id+'.ogg']||null;}
  async execute(action,{instant=false,silent=false}: any={}){
    if(action.op==='dialogue'){
      const phrase=action.data.Phrase;this.ui.line(phrase);this.type(plain(phrase.Text),instant);this.current=action;
      if(!silent){for(const [kind,file]of Object.entries<any>(this.desiredAudio||{})){if(!file)this.audio.stop(kind);else if(this.audio.channels.get(kind)?.file!==file){const channel=this.audio.play(kind,file,{kind,loop:true});if(channel)channel.file=file;}}
        if(!this.fast&&!this.skip)this.playVoices((phrase.VoiceAssetIds||[]).map(id=>this.file('ASA',id)).filter(Boolean),this.token);}
      return;
    }
    if(action.op!=='frame')return;const token=this.token,data=action.data,bg=data.Background||{};
    if(this.scene&&this.scene!==action.scene){for(const actor of this.actors.values()){actor.player.destroy();actor.host.remove();}this.actors.clear();this.audio.stopAll();this.desiredAudio={};this.bgKey=null;this.motionKey=null;}
    this.scene=action.scene;
    if(bg.FadeType&&!instant){this.fade.style.background=bg.FadeType===1?'#fff':'#000';this.fade.style.transition='opacity '+seconds(bg.FadeInDuration)+'s linear';this.fade.style.opacity='1';await this.wait(seconds(bg.FadeInDuration)+seconds(bg.FadeWaitDuration));if(token!==this.token)return;}
    if(bg.AssetId){const key=(bg.Type||0)+':'+bg.AssetId;if(this.bgKey!==key){this.bgKey=key;
      if(bg.Type===2){const model=this.story.models['SBSX/'+bg.AssetId];if(!model)throw new Error('动态 CG 未完整下载，请更新剧情。');this.cg?.destroy();this.cg=new Player(this.motion);this.motion.hidden=false;this.background.hidden=true;const play=animation(bg.AdultStillAnimationType,model.animations);await this.cg.load({...model,fit:'cover'},{animation:play.name,loop:play.loop,assetRoot:this.assetRoot});this.motionKey=null;}
      else{this.cg?.destroy();this.cg=null;this.motion.hidden=true;const file=this.file(bg.Type===5?'TSTX':'TAB',bg.AssetId);if(!file)throw new Error('背景未完整下载，请更新剧情。');this.background.src=this.asset(file);this.background.hidden=false;}
    }}
    if(token!==this.token)return;
    if(this.cg&&bg.Type===2){const model=this.cg.model,play=animation(bg.AdultStillAnimationType,model.animations),key=model.file+':'+(bg.AdultStillAnimationType??0);this.motionSpeed=Math.max(.05,(bg.AnimationSpeed??1000)/1000);this.setRate();
      if(this.motionKey!==key){this.motionKey=key;let duration=0;for(const spine of this.cg.spines){const entry=spine.state.setAnimation(0,instant&&play.next?play.next:play.name,instant&&play.next?true:play.loop);duration=Math.max(duration,entry.animation.duration);if(play.next&&!instant)spine.state.addAnimation(0,play.next,true,0);spine.update(0);}if(bg.WaitAnimation&&!play.loop&&!instant){await this.wait(duration/this.motionSpeed);if(token!==this.token)return;}}
    }
    for(const [key,kind,prefix,loop] of [['BgmAssetId','bgm','ASBM',true],['VoiceAssetId','bgv','ASA',true],['SoundEffect','se','ASASE',false]] as const)if(Object.hasOwn(bg,key)){const file=this.file(prefix,bg[key]);if(loop)this.desiredAudio[kind]=file;if(silent)continue;if(!file){if(!bg[key])this.audio.stop(kind);}else if(kind==='se'||this.audio.channels.get(kind)?.file!==file){const channel=this.audio.play(kind,file,{kind,loop});if(channel)channel.file=file;}}
    for(const key of ['Character1','Character2','Character3','Character4','HiddenCharacter']){
      const spec=data[key];if(!spec)continue;
      if(spec.Deactivate){for(const [slot,actor]of this.actors)if(slot===key||actor.id===spec.AssetId){actor.player.destroy();actor.host.remove();this.actors.delete(slot);}continue;}
      if(!spec.AssetId)continue;let actor=this.actors.get(key);
      if(!actor||actor.id!==spec.AssetId){actor?.player.destroy();actor?.host.remove();const model=this.story.models['SCS/'+spec.AssetId];if(!model)throw new Error('剧情立绘未完整下载，请更新剧情。');const host=node('div','muv-story-actor');this.actorHost.append(host);actor={host,id:spec.AssetId,player:new Player(host)};this.actors.set(key,actor);await actor.player.load({...model,fit:'stage'},{animation:FACES[spec.FacialType??0],assetRoot:this.assetRoot,placement:{frameWidth:1920,frameHeight:1080,x:(spec.X||0)/10,y:-(spec.Y||0)/10,scale:(spec.Scale||1000)/1000}});if(token!==this.token)return;}
      const pose=FACES[spec.FacialType??0]||'Normal';if(actor.player.model.animations.includes(pose))actor.player.setAnimation(pose,true);
      const start={...actor.player.placement},end={...start,x:(spec.MovePathXs?.at(-1)??spec.X??start.x*10)/10,y:-(spec.MovePathYs?.at(-1)??spec.Y??-start.y*10)/10,scale:(spec.MoveScale??spec.Scale??start.scale*1000)/1000};
      actor.player.placement=end;actor.player.fit();actor.host.classList.toggle('muv-talking',data.Phrase?.Speakers?.includes(Number(key.slice(-1)))||false);
      if(spec.HasMove&&!instant){actor.move?.cancel();actor.host.style.transformOrigin=`${50+end.x/1920*100}% ${50+end.y/1080*100}%`;const xs=spec.MovePathXs||[end.x*10],ys=spec.MovePathYs||[-end.y*10],points=[start,...Array.from({length:Math.max(xs.length,ys.length)},(_,i)=>({x:(xs[i]??xs.at(-1))/10,y:-(ys[i]??ys.at(-1))/10,scale:start.scale+(end.scale-start.scale)*(i+1)/Math.max(xs.length,ys.length)}))];actor.move=this.animate(actor.host,points.map(p=>({transform:`translate(${(p.x-end.x)/1920*100}%,${(p.y-end.y)/1080*100}%) scale(${p.scale/end.scale})`})),Math.max(spec.MovePathDuration||0,spec.MoveScaleDuration||0));}
      if(spec.FadeInType&&!instant)this.animate(actor.host,[{opacity:0},{opacity:1}],250);
      if(spec.ShakeStrength&&!instant){const distance=spec.ShakeStrength/10;this.animate(actor.host,[0,1,-1,.5,-.5,0].map(n=>({transform:`translate(${spec.ShakeAxisFlags&1?n*distance:0}px,${spec.ShakeAxisFlags&2?n*distance:0}px)`})),300,{composite:'add'});}
    }
    if(bg.FadeType){if(!instant&&bg.FadeFlashCount){for(let i=0;i<Math.min(bg.FadeFlashCount,10);i++){this.fade.style.opacity='0';await this.wait(seconds(bg.FadeFlashDuration));this.fade.style.opacity='1';await this.wait(seconds(bg.FadeFlashDuration));if(token!==this.token)return;}}this.fade.style.transition=instant?'none':'opacity '+seconds(bg.FadeOutDuration)+'s linear';this.fade.style.opacity='0';}
  }
  playVoices(files,token){const next=()=>{if(token!==this.token||!files.length)return;const channel=this.audio.play('voice',files.shift(),{kind:'voice'});if(channel)channel.audio.onended=next;};next();}
  setRate(){for(const spine of this.cg?.spines||[])spine.state.timeScale=(this.motionSpeed||1)*(this.fast||this.skip?8:1);}
  fail(error){this.error.textContent=error.message;this.error.hidden=false;this.auto=false;this.skip=false;this.toolbar.previous.disabled=this.toolbar.next.disabled=this.toolbar.restart.disabled=true;this.clearAuto();this.onError(error);}
  destroy(){this.toolbar.destroy();this.hold.destroy();this.ui?.destroy();this.engine?.stop();this.stopPlayback();this.cg?.destroy();for(const actor of this.actors.values())actor.player.destroy();this.actors.clear();this.observer.disconnect();document.removeEventListener('visibilitychange',this.visibility);this.container.replaceChildren();}
}
