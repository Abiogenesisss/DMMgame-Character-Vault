import { StoryEngine, StoryAudio } from './story-engine.ts';
import { Player } from './player.ts';
import { loadNativeUi, paintText } from './native-ui.ts';
import { OriginalStoryUi } from './story-ui.ts';
import { StoryScene } from './story-scene.ts';
import { DotabyssClickEffect } from './click-effect.ts';
import { HoldForward } from './hold-forward.ts';
import { StoryControls } from '../../../app/viewer/story-controls.ts';

const node=(tag,className?: any,text?: any)=>{const item=document.createElement(tag);if(className)item.className=className;if(text!=null)item.textContent=text;return item;};
const number=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const on=value=>String(value).toLowerCase()==='on'||value==='1';
const colors={black:'#000000',white:'#ffffff',red:'#ff0000'};
export class DotabyssStoryPlayer{
  declare container: any;
  declare asset: any;
  declare assetRoot: any;
  declare positionKey: any;
  declare onError: any;
  declare token: any;
  declare animations: any;
  declare activeModel: any;
  declare auto: any;
  declare hiddenUi: any;
  declare audio: any;
  declare observer: any;
  declare visibility: any;
  declare stage: any;
  declare back: any;
  declare camera: any;
  declare motion: any;
  declare overlay: any;
  declare window: any;
  declare marker: any;
  declare speed: any;
  declare error: any;
  declare scene: any;
  declare footer: any;
  declare previous: any;
  declare toolbar: StoryControls;
  declare next: any;
  declare position: any;
  declare closeButton: any;
  declare fullscreenButton: any;
  declare hold: any;
  declare engine: any;
  declare ui: any;
  declare autoTimer: any;
  declare fastForward: any;
  declare typing: any;
  declare lineDisplayed: any;
  declare theme: any;
  declare story: any;
  declare nativeData: any;
  declare clickEffect: any;
  declare player: any;
  declare typeTimer: any;
  declare controls: any;
  declare textMode: any;
  declare speakerName: any;
  declare fullText: any;
  declare textInterval: any;
  declare log: any;

  constructor(container,{asset,assetRoot,positionKey,onError=()=>{}}){
    this.container=container;this.asset=asset;this.assetRoot=assetRoot;this.positionKey=positionKey;this.onError=onError;this.token=0;this.animations=new Set<string>();this.activeModel=null;this.auto=false;this.hiddenUi=false;
    this.audio=new StoryAudio({asset});this.observer=new ResizeObserver(()=>this.fit());this.visibility=()=>{if(document.hidden)this.audio.pauseAll();else this.audio.resumeAll();};document.addEventListener('visibilitychange',this.visibility);
    this.render();this.observer.observe(this.stage);
  }
  render(){
    this.stage=node('div','dotabyss-stage');this.stage.tabIndex=0;this.stage.setAttribute('aria-label','DOTABYSS 剧情画面，点击或按空格继续');
    this.back=node('img','dotabyss-background');this.back.alt='剧情背景';this.back.hidden=true;
    this.camera=node('div','dotabyss-camera');this.motion=node('div','dotabyss-model');this.camera.append(this.motion);this.overlay=node('div','dotabyss-fade');
    this.window=node('div');this.marker=node('span');this.marker.hidden=true;this.speed={value:'40'};
    this.error=node('div','dotabyss-error');this.error.hidden=true;this.error.setAttribute('role','alert');
    this.stage.append(this.back,this.camera,this.overlay,this.error);
    this.scene=new StoryScene(this);this.scene.reset();
    this.position=node('span','dotabyss-position');
    this.toolbar=new StoryControls(this.container,{previous:()=>this.engine?.previous(),next:()=>this.engine?.next(),restart:()=>this.restart()},{className:'dotabyss-reader-footer',position:this.position,onError:this.onError});
    this.footer=this.toolbar.element;this.previous=this.toolbar.previous;this.next=this.toolbar.next;this.closeButton=this.toolbar.close;this.fullscreenButton=this.toolbar.fullscreen;
    this.position.textContent='正在读取剧情…';
    this.container.replaceChildren(this.stage,this.footer);
    this.hold=new HoldForward(this.stage,{canStart:event=>{
      if(!this.engine||this.engine.ended||this.ui?.modal||this.hiddenUi||this.window.hidden||event.target.closest('button,input,[role=button],.dotabyss-native-popup'))return false;
      const r=this.window.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;
    },onChange:value=>this.setFastForward(value),onAdvance:()=>{if(this.engine?.ended||this.ui?.modal)this.hold.stop();else this.engine?.next();}});
    this.stage.addEventListener('click',event=>{if(event.target.closest('button,input,[role=button],.dotabyss-native-popup'))return;if(this.hiddenUi){this.toggleUi();return;}this.engine?.next();});
    this.stage.addEventListener('keydown',event=>{if(event.target.closest('button,input,[role=button],.dotabyss-native-popup'))return;if(event.code==='Space'||event.key==='Enter'||event.key==='ArrowRight'){event.preventDefault();this.engine?.next();}else if(event.key==='ArrowLeft'){event.preventDefault();this.engine?.previous();}});
    this.autoTimer=setInterval(()=>{if(this.auto&&!this.fastForward&&!this.ui?.modal&&!document.hidden&&this.engine?.waiting&&!this.typing&&!this.audio.voicePlaying&&performance.now()-this.lineDisplayed>(this.theme?.autoWaitTime||1)*1000)this.engine.next();},100);
  }
  async load(story){
    this.story=story;if(story.program?.version!==2)throw new Error('请更新此角色的完整剧情素材。');
    const token=this.token;
    if(!story.ui)throw new Error('请先点击“下载播放器 UI”补齐本地界面。');
    const response=await fetch(this.asset(story.ui));if(!response.ok)throw new Error('本地剧情窗口读取失败，请下载播放器 UI 后重试。');this.theme=await response.json();if(token!==this.token)return;
    if(!this.theme.native)throw new Error('原版窗口素材尚未安装，请下载播放器 UI 后重试。');
    this.nativeData=await loadNativeUi(this.theme.native,this.asset);if(token!==this.token)return;
    this.ui=new OriginalStoryUi(this,this.nativeData);this.applyTheme();
    this.clickEffect?.destroy();if(this.nativeData.click)this.clickEffect=new DotabyssClickEffect(this.nativeData.click,{asset:this.asset,root:this.container});
    if(story.segments?.length>1)this.positionKey+='-complete-v1';
    this.engine=new StoryEngine(story.program,{execute:(action,options)=>this.execute(action,options),reset:()=>this.reset(),stop:()=>this.stop(),stopVoice:()=>this.audio.stop('voice'),reveal:()=>this.reveal(),finish:()=>this.finish()},{onLine:(action,line)=>this.line(action,line),onEnd:()=>{this.next.disabled=true;this.position.textContent='剧情结束';},onError:error=>this.fail(error)});
    const saved=Number(localStorage.getItem(this.positionKey));const line=Number.isInteger(saved)&&saved>=0&&saved<story.program.dialogue?saved:0;await this.engine.start({line});
    if(this.engine.waiting&&this.container.isConnected&&!this.container.contains(document.activeElement))this.stage.focus({preventScroll:true});
  }
  applyTheme(){
    if(this.theme.webBackground)this.container.style.backgroundImage='url("'+this.asset(this.theme.webBackground)+'")';
    this.fit();
  }
  fit(){const width=this.stage.getBoundingClientRect().width;this.stage.style.setProperty('--native-unit',(width/1920||.5)+'px');}
  toggleUi(){this.hiddenUi=!this.hiddenUi;this.stage.classList.toggle('dotabyss-ui-hidden',this.hiddenUi);}
  setFastForward(value){this.fastForward=value;this.engine?.setFastForward(value);this.stage.classList.toggle('dotabyss-fast-forward',value);if(value){this.ui?.setAuto(false);this.reveal();this.audio.stop('voice');for(const animation of this.animations)animation.finish?.();}}
  restart(){if(!this.engine)return;this.ui?.setAuto(false);this.hold.stop();this.setFastForward(false);if(this.hiddenUi)this.toggleUi();return this.engine.start();}
  fail(error){this.engine?.stop();this.stop();this.error.textContent=error.message;this.error.hidden=false;this.position.textContent='素材读取失败';this.next.disabled=true;this.previous.disabled=true;this.toolbar.restart.disabled=true;this.onError(error);}
  stop(){this.hold?.stop();this.token++;this.audio.stopAll();this.player?.destroy();this.player=null;this.activeModel=null;this.scene?.reset();clearTimeout(this.typeTimer);this.typing=false;for(const animation of this.animations)animation.cancel();this.animations.clear();}
  reset(){this.stop();this.scene.reset();this.ui?.closeModal(true);this.ui?.setWindow(false);this.error.hidden=true;this.overlay.style.opacity='0';this.window.style.opacity='0';this.window.hidden=true;if(this.controls)this.controls.hidden=false;this.camera.hidden=false;this.camera.style.opacity='1';this.camera.style.transform='';this.camera.style.translate='';this.camera.style.filter='';this.back.hidden=true;this.next.disabled=false;}
  async animate(element,properties,duration,instant){
    const token=this.token;if(instant||!(duration>0)||!element.animate){Object.assign(element.style,properties);return;}
    const before=Object.fromEntries(Object.keys(properties).map(key=>[key,getComputedStyle(element)[key]])),animation=element.animate([before,properties],{duration:duration*1000,fill:'forwards',easing:'linear'});this.animations.add(animation);
    await animation.finished.catch(()=>{});this.animations.delete(animation);if(token===this.token)Object.assign(element.style,properties);animation.cancel();
  }
  async model(id,time){
    const model=this.story.models?.[id];if(!model)throw new Error('此 CG 的演出素材尚未保存。');if(this.activeModel===id)return;
    this.player?.destroy();this.player=new Player(this.motion);this.activeModel=id;
    await this.player.load(model,{scripted:true,fit:'cover',clock:()=>this.engine.time,initialTime:time,assetRoot:this.assetRoot});
  }
  async execute(action,{instant=false,silent=false,time}: any={}){
    instant=instant||this.fastForward;
    const a=action.args,op=action.op;
    if(action.placeholder)return;
    if(await this.scene.execute(action,{instant,silent,time}))return;
    if(op==='segment'){this.audio.stopAll();this.player?.destroy();this.player=null;this.activeModel=null;this.scene.reset();this.camera.hidden=false;this.camera.style.transform='';this.camera.style.opacity='1';this.ui.setWindow(false);return;}
    if(op==='l2dshow'){await this.model(a[0],time);this.camera.hidden=false;}
    else if(op==='l2dhide'){this.player?.destroy();this.player=null;this.activeModel=null;}
    else if(op==='l2dmotion'){if(!this.player?.playCommand(a[0],on(a[1]),time))throw new Error('此 CG 的表情动作尚未保存，请更新剧情素材。');}
    else if(op==='fade'){this.overlay.style.background=colors[String(a[1]).toLowerCase()]||'#000';await this.animate(this.overlay,{opacity:String(a[0]).toLowerCase()==='out'?'1':'0'},number(a[2]),instant);}
    else if(op==='window'){this.window.hidden=false;await this.animate(this.window,{opacity:on(a[0])?'1':'0'},number(a[1]),instant);if(!on(a[0]))this.window.hidden=true;}
    else if(op==='uivisible'){this.controls.hidden=!on(a[0]);}
    else if(op==='adultui'){this.stage.dataset.window=on(a[0])?'adult':'normal';this.ui.setWindow(on(a[0]));}
    else if(op==='bgmplay'||op==='bgvplay'||op==='seplay'||op==='seplayIngame'){
      const resource=this.story.audio[action.audioKey||a[1]],kind=op==='bgmplay'?'bgm':op==='bgvplay'?'bgv':'se',offset=op==='seplayIngame'?1:0;
      if(!resource?.file)throw new Error('此剧情的音频尚未保存，请更新剧情素材。');
      if((!silent||kind!=='se')&&(!this.fastForward||kind!=='se'))this.audio.play(a[0],resource.file,{kind,loop:kind==='bgm'||kind==='bgv'&&(a[3]?on(a[3]):resource.loop),fade:instant?0:number(a[2+offset]),volume:kind==='bgv'?1:number(a[3+offset],1)});
    }else if(op==='bgmstop'||op==='bgvstop'||op==='sestop')await this.audio.stop(a[0],instant?0:number(a[1]));
    else if(action.dialogue!==undefined){
      this.textMode=['messageTextCenter','messageTextUnder'].includes(op)?op:null;this.scene.overlay.hidden=!this.textMode;if(this.textMode){this.scene.overlay.style.inset=this.textMode==='messageTextUnder'?'65% 10% 8%':'20% 10%';}
      this.showText(action.speaker,action.text,instant);const file=action.cue&&this.story.audio[action.cue]?.file;this.audio.stop('voice');if(action.cue&&!file)throw new Error('本句配音尚未保存，请更新剧情素材。');if(file&&!silent&&!this.fastForward)this.audio.play('voice',file,{kind:'voice'});
    }else if(op==='cleanall'){this.audio.stopAll();this.player?.resetCommands();this.scene.reset();}
    else if(op==='colorfade'){this.overlay.style.background=`rgb(${a.slice(1,4).map(value=>number(value)).join(',')})`;await this.animate(this.overlay,{opacity:String(number(a[5])/255)},number(a[0]),instant);}
    else if(op==='screeneffect'){this.camera.style.filter=on(a[1])&&a[0]==='SEPIATONE'?'sepia(1)':on(a[1])&&a[0]==='MONOCHROME'?'grayscale(1)':'none';}
    else if(op==='transitionFade'){this.overlay.style.background=colors[String(a[2]).toLowerCase()]||'#000';await this.animate(this.overlay,{opacity:a[1]==='out'?'1':'0'},number(a[3]),instant);}
    else throw new Error('该剧情包含暂未支持的演出：'+op);
  }
  showText(speaker,text,instant){
    clearTimeout(this.typeTimer);this.speakerName=speaker==='<user>'?'プレイヤー':speaker;this.writeText('');
    const plain=String(text).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/?(?:color|size|b|i|ruby|rt|font)(?:=[^>]*)?>/gi,'').replace(/\\n/g,'\n');
    this.fullText=plain;this.typing=!instant&&this.textInterval>0;this.marker.hidden=true;let at=0;const letters=[...plain],token=this.token;
    const type=()=>{if(token!==this.token)return;this.writeText(letters.slice(0,++at).join(''));if(at<letters.length&&this.typing)this.typeTimer=setTimeout(type,this.textInterval);else{this.typing=false;this.writeText(plain);this.marker.hidden=false;}};
    if(this.typing)type();else{this.writeText(plain);this.marker.hidden=!this.theme.marker?.file;}
  }
  writeText(value){if(this.textMode)paintText(this.scene.overlay,value,Object.values<any>(this.nativeData.fonts)[0],{size:36,outline:.15,lineHeight:64,horizontal:2,vertical:512},1536,this.textMode==='messageTextUnder'?292:648);else this.ui?.writeText(this.speakerName||'',value);}
  reveal(){if(!this.typing)return false;clearTimeout(this.typeTimer);this.typing=false;this.writeText(this.fullText);this.marker.hidden=!this.theme.marker?.file;return true;}
  line(action,line){this.lineDisplayed=performance.now();this.previous.disabled=line===0;this.next.disabled=false;this.toolbar.restart.disabled=false;this.position.textContent=(line+1)+' / '+this.story.program.dialogue;localStorage.setItem(this.positionKey,String(line));}
  showLog(){this.ui?.openLog();this.log=this.ui?.modal?.host;}
  finish(){this.hold.stop();this.audio.stopAll();this.marker.hidden=true;}
  destroy(){this.toolbar.destroy();this.engine?.stop();this.stop();this.hold.destroy();this.clickEffect?.destroy();this.ui?.destroy();this.ui=null;this.scene.destroy();clearInterval(this.autoTimer);this.observer.disconnect();document.removeEventListener('visibilitychange',this.visibility);this.container.replaceChildren();}
}
