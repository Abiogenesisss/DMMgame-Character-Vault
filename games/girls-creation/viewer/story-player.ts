import {Player} from './spine-player.ts';
import {readScene,actorPlacement} from './reader-scene.ts';
import {StoryUi,cleanText} from './story-ui.ts';
import {SceneTransitions,drawCover} from './scene-transitions.ts';
import {StoryControls} from '../../../app/viewer/story-controls.ts';
const node=(tag,cls='',text=''):any=>{const el=document.createElement(tag);el.className=cls;if(text)el.textContent=text;return el;};
export class GirlsStoryPlayer {
  stage:any;background:any;actorHost:any;motion:any;ui:StoryUi;footer:any;position:any;previous:any;toolbar:StoryControls;observer:any;
  story:any;indices:number[]=[];cursor=0;generation=0;actors=new Map<string,any>();director:any;voice=new Audio();music=new Audio();sound=new Audio();
  musicFile:any;soundToken:any;auto=false;skip=false;timer:any;typeTimer:any;typing=false;fullText='';destroyed=false;events=new AbortController();
  effects:SceneTransitions;animations=new Set<any>();pending=new Set<Promise<any>>();waits=new Set<()=>void>();captured:any;playing=false;movieWaiting=false;fast=false;lastCommand=-1;ended=false;backgroundPlacement:any;
  constructor(private container,private options){
    this.stage=node('div','gc-story-stage');this.stage.tabIndex=0;this.stage.setAttribute('aria-label','少女艺术绮谭剧情，点击或按空格继续');
    this.background=node('img','gc-story-background');this.background.alt='剧情背景';this.background.hidden=true;this.actorHost=node('div','gc-story-actors');this.motion=node('div','gc-story-motion');this.motion.hidden=true;this.stage.append(this.background,this.actorHost,this.motion);
    this.effects=new SceneTransitions(this.stage);
    this.ui=new StoryUi(this.stage,options.asset,{next:()=>this.next(),auto:()=>this.setAuto(!this.auto),skip:()=>this.setSkip(!this.skip),pause:()=>{this.setAuto(false);this.setSkip(false);this.voice.pause();this.talking(false);},settings:()=>this.applyVolume(),history:()=>this.history(),cursor:()=>this.cursor,go:i=>{this.cursor=i;this.showLine(true);},replay:file=>this.replay(file)});
    this.position=node('span','gc-story-position');this.position.id='story-position';
    this.toolbar=new StoryControls(container,{previous:()=>{if(this.cursor>0){this.cursor--;return this.showLine(true);}},next:()=>this.next(),restart:()=>this.restart()},{className:'gc-story-footer',position:this.position,onError:options.onError});
    this.footer=this.toolbar.element;this.previous=this.toolbar.previous;this.previous.id='previous-line';container.replaceChildren(this.stage,this.footer);
    this.music.loop=true;this.applyVolume();
    this.observer=new ResizeObserver(()=>{this.stage.style.setProperty('--gc-unit',this.stage.clientWidth/1920+'px');this.ui.fitText();});this.observer.observe(this.stage);
    this.stage.addEventListener('click',e=>{if(!e.target.closest('button,input,label,[role="dialog"]'))this.next();},{signal:this.events.signal});
    this.stage.addEventListener('keydown',e=>{if(e.target.closest('button,input,[role="dialog"]'))return;if(e.code==='Space'||e.key==='ArrowRight'){e.preventDefault();this.next();}else if(e.key==='ArrowLeft'){e.preventDefault();this.previous.click();}},{signal:this.events.signal});
    this.voice.addEventListener('ended',()=>{this.talking(false);this.queueAuto();},{signal:this.events.signal});this.voice.addEventListener('pause',()=>this.talking(false),{signal:this.events.signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(this.timer);this.voice.pause();this.music.pause();this.sound.pause();}else{if(this.musicFile)this.music.play().catch(()=>{});this.queueAuto();}},{signal:this.events.signal});
  }
  async load(story){
    this.story=story;this.indices=story.commands.flatMap((row,index)=>row.command==='mess'?[index]:[]);if(!this.indices.length)throw Error('剧情没有可显示的对白。');
    await this.ui.load(story.ui||this.options.library.storyUi?.file);if(this.destroyed)return;
    const saved=Number(localStorage.getItem(this.options.positionKey));this.cursor=Number.isInteger(saved)&&saved>=0&&saved<this.indices.length?saved:0;
    this.ui.host.hidden=story.programVersion===3;
    await this.showLine(this.cursor>0||story.programVersion!==3);this.stage.focus({preventScroll:true});
    if(story.missingMovies?.length)this.options.onError?.(new Error('此段视频尚未保存，当前可阅读已保存的脚本与配音。'));
  }
  applyVolume(){this.music.volume=this.ui.config.bgm/100;this.sound.volume=this.ui.config.se/100;this.voice.volume=this.ui.config.voice/100;}
  history(){return this.indices.slice(0,this.cursor+1).map(i=>{const line=this.story.commands[i];return {speaker:line.args[0]||'',text:cleanText(line.args[1]),voice:this.story.voices?.[line.args[2]]};});}
  currentVoice(){return this.story?.voices?.[this.story.commands[this.indices[this.cursor]]?.args[2]];}
  talking(value){for(const view of this.actors.values())view.player?.setTalking(value&&view.actor.talking);}
  replay(file){if(!file)return;this.voice.pause();this.voice.src=this.options.asset(file);this.voice.play().then(()=>this.talking(!this.ui.modal)).catch(()=>{});}
  playVoice(){if(!this.ui.title&&!this.ui.modal&&!this.skip&&this.ui.config.autovoice)this.replay(this.currentVoice());}
  seconds(value){return this.fast||this.skip||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:Math.max(0,Math.min(30,Number(value)||0))*1000;}
  animate(host,frames,duration,easing='linear'){
    const ms=this.seconds(duration);if(!host?.animate||!ms)return Promise.resolve();
    const name=String(easing).toLowerCase(),curve=name.includes('cubic')?'cubic-bezier(.33,1,.68,1)':name.includes('quad')?'cubic-bezier(.25,.46,.45,.94)':name.includes('ease')?'ease-in-out':'linear';
    const animation=host.animate(frames,{duration:ms,easing:curve,fill:'none'});this.animations.add(animation);return animation.finished.catch(()=>{}).finally(()=>this.animations.delete(animation));
  }
  delay(seconds){const ms=this.seconds(seconds);if(!ms)return Promise.resolve();return new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);this.waits.delete(finish);resolve();};const timer=setTimeout(finish,ms);this.waits.add(finish);});}
  finishAnimations(){for(const animation of this.animations)try{animation.finish();}catch{}for(const finish of this.waits)finish();this.effects.cancel();}
  async setBackground(file,placement={}){
    placement||={};
    this.backgroundPlacement=placement;this.background.hidden=!file;
    if(file){const url=this.options.asset(file);if(this.background.getAttribute('src')!==url){this.background.src=url;await this.background.decode?.().catch(()=>{});}}else this.background.removeAttribute('src');
    const bg:any=placement;this.background.style.transform=`translate(${(bg.x||0)/19.2}%,${-(bg.y||0)/10.8}%) scale(${bg.scaleX??1},${bg.scaleY??1})`;
  }
  setMusic(file){if(this.musicFile===file)return;this.music.pause();this.musicFile=file;if(file){this.music.src=this.options.asset(file);this.music.play().catch(()=>{});}else this.music.removeAttribute('src');}
  captureScene(){
    const canvas=document.createElement('canvas');canvas.width=this.stage.clientWidth||1920;canvas.height=this.stage.clientHeight||1080;const ctx=canvas.getContext('2d');if(!ctx)return null;
    if(!this.background.hidden&&this.background.complete)drawCover(ctx,this.background,canvas.width,canvas.height,this.backgroundPlacement);
    for(const view of [...this.actors.values()].sort((a,b)=>(a.actor.z||0)-(b.actor.z||0))){const image=view.player?.capture()||(!view.player?view.node:null);if(!image)continue;ctx.globalAlpha=view.actor.alpha??1;ctx.drawImage(image,0,0,canvas.width,canvas.height);}ctx.globalAlpha=1;
    const movie=this.director?.capture();if(movie)drawCover(ctx,movie,canvas.width,canvas.height);return canvas;
  }
  resolveActor(actor){const file=this.story.resources?.[actor.reference];return {...actor,file,model:(this.options.library.skeletons||[]).find(m=>m.kind==='portrait'&&m.file===file)||null};}
  async actorAction(actor,operation,timing,generation){
    const resolved=this.resolveActor(actor);if(!resolved.file)return;
    const cast=[...this.actors.values()].map(v=>v.actor).filter(a=>a.key!==actor.key);cast.push(resolved);
    await this.showActors(cast,generation,true);if(generation!==this.generation)return;const view=this.actors.get(actor.key);if(!view)return;
    if(operation==='fade')await this.animate(view.node,[{opacity:timing.from},{opacity:actor.alpha}],timing.duration);
    else if(operation==='move')await this.animate(view.node,[{transform:`translate(${(timing.from.x-actor.x)/19.2}%,${-(timing.from.y-actor.y)/10.8}%)`},{transform:'none'}],timing.duration,timing.easing);
    else if(operation==='scale'){
      const p=actorPlacement(resolved);view.node.style.transformOrigin=`${50+p.x/19.2}% ${50+p.y/10.8}%`;
      await this.animate(view.node,[{transform:`scale(${timing.from.scaleX/(actor.scaleX||1)},${timing.from.scaleY/(actor.scaleY||1)})`},{transform:'none'}],timing.duration,timing.easing);
    }else if(operation==='jump'||operation==='shake'){
      const frames=[];for(let i=0;i<Math.max(1,Math.min(8,timing.count));i++)for(const factor of operation==='jump'?[0,1,0]:[0,1,-1,.5,-.5,0])frames.push({transform:operation==='jump'?`translateY(${factor*timing.amount/10.8}%)`:`translateX(${factor*timing.amount/19.2}%)`});
      await this.animate(view.node,frames,timing.duration,'ease');
    }
  }
  async setVideo(scene,generation){
    const model=scene.model;this.motion.hidden=!model;
    if(model){
      if(this.director?.model!==model){this.director||=new Player(this.motion);await this.director.load(model,{...scene,controls:false,fit:'cover',assetRoot:this.options.assetRoot});}
      else await this.director.selectAnimation(scene.animation,scene.loop,scene.token);
      if(generation!==this.generation)return;
    }else{this.director?.destroy();this.director=null;}
  }
  async execute(command,index,generation){
    const args=command.args;
    if(command.command==='actor')await this.actorAction(args[0],args[1],args[2],generation);
    else if(command.command==='actor_delete'){const view=this.actors.get(args[0]);view?.player?.destroy();view?.node.remove();this.actors.delete(args[0]);}
    else if(command.command==='capture'){this.captured=this.captureScene();this.effects.hold(this.captured);await this.showActors([],generation,true);this.director?.destroy();this.director=null;this.motion.hidden=true;}
    else if(command.command==='image')await this.setBackground(this.story.resources?.[args[0]],args[1]);
    else if(command.command==='transition'){
      const t=args[0];if(typeof t!=='object')return;const out=t.direction==='out',mask=this.story.resources?.[t.mask];
      await this.effects.run({mask:mask?this.options.asset(mask):null,color:t.color==='white'?'#fff':'#000',from:out?0:1,to:out?1:0,duration:this.seconds(t.duration)});
    }else if(command.command==='crossfade'){
      const t=args[0],mask=this.story.resources?.[t.mask];await this.effects.run({snapshot:this.captured,mask:mask?this.options.asset(mask):null,from:1,to:0,duration:this.seconds(t.duration)});this.captured=null;
    }else if(command.command==='window'){
      this.ui.host.hidden=this.ui.hidden;await this.animate(this.ui.host,[{opacity:args[0]?0:1},{opacity:args[0]?1:0}],args[1]);if(generation===this.generation){this.ui.host.hidden=this.ui.hidden||!args[0];if(!args[0])this.ui.line('','');}
    }else if(command.command==='title'){if(!this.fast&&!this.skip)await this.ui.chapter(args[0]);}
    else if(command.command==='wait')await this.delay(args[0]);
    else if(command.command==='music')this.setMusic(this.story.resources?.[args[0]]||null);
    else if(command.command==='sound'){this.soundToken=index;this.sound.pause();const file=this.story.resources?.[args[0]];if(file){this.sound.src=this.options.asset(file);this.sound.play().catch(()=>{});}}
    else if(['movie','spine','spine_play'].includes(command.command)){
      await this.setVideo(readScene(this.story,index,this.options.library.skeletons||[],this.options.library.images||[]),generation);if(generation!==this.generation)return;
      if(command.command==='movie'&&args[0].mode==='wait'){
        this.movieWaiting=true;this.ui.next.disabled=true;
        try{await this.director?.waitForVideo();}finally{if(generation===this.generation){this.movieWaiting=false;this.ui.next.disabled=false;}}
      }
    }
  }
  async executeRange(start,end,generation){
    for(let i=start;i<end&&generation===this.generation;i++){
      const command=this.story.commands[i];if(command.command==='await'){await Promise.all(this.pending);continue;}
      const promise=this.execute(command,i,generation);
      if((command.command==='actor'?command.args[2]:command.args[0])?.async){
        const task=promise.catch(error=>{if(generation===this.generation)this.options.onError?.(error);}).finally(()=>this.pending.delete(task));this.pending.add(task);
      }else await promise;
    }
  }
  async showActors(actors,generation,instant){
    const wanted=new Set(actors.map(a=>a.key||a.reference));
    for(const [key,view]of this.actors)if(!wanted.has(key)){view.player?.destroy();view.node.remove();this.actors.delete(key);}
    await Promise.all(actors.map(async actor=>{
      const key=actor.key||actor.reference;let view=this.actors.get(key);
      if(view&&view.file!==actor.file){view.player?.destroy();view.node.remove();this.actors.delete(key);view=null;}
      if(!view){
        const host=node(actor.model?'div':'img','gc-story-actor');host.dataset.actor=key;host.style.opacity=String(actor.alpha??1);this.actorHost.append(host);
        view={file:actor.file,node:host,actor,player:actor.model?new Player(host):null};this.actors.set(key,view);
        if(view.player)view.loading=view.player.load({...actor.model,fit:'stage'},{assetRoot:this.options.assetRoot,animation:actor.animation||'loop',placement:actorPlacement(actor)});
        else{host.src=this.options.asset(actor.file);host.alt='剧情角色立绘';}
      }
      view.actor=actor;
      try{await view.loading;}catch{if(generation===this.generation)this.options.onError?.(new Error('剧情立绘未能加载。'));return;}
      if(generation!==this.generation||this.actors.get(key)!==view)return;
      const placement=actorPlacement(actor);view.node.style.zIndex=String(Math.round(actor.z||0));view.node.style.opacity=String(Math.max(0,Math.min(1,actor.alpha??1)));
      if(view.player){view.player.placement=placement;view.player.setPose(actor);view.player.fit();}
      else{view.node.style.objectFit='contain';view.node.style.transform=`translate(${(actor.x||0)/19.2}%,${-(actor.y||0)/10.8}%) scale(${actor.scaleX??1},${actor.scaleY??1})`;}
    }));
  }
  async showLine(instant=false){
    if(this.destroyed||!this.story)return;
    if(instant||!this.generation){this.generation++;this.finishAnimations();this.director?.cancelVideoWait();this.movieWaiting=false;this.pending.clear();}
    const generation=this.generation,live=!instant&&this.story.programVersion===3;this.playing=true;this.fast=instant;this.ended=false;clearTimeout(this.timer);clearTimeout(this.typeTimer);this.voice.pause();this.talking(false);
    const commandIndex=this.indices[this.cursor],line=this.story.commands[commandIndex];
    try{if(live)await this.executeRange(this.lastCommand+1,commandIndex,generation);else{this.effects.clear();this.captured=null;this.ui.dismissTitle();this.ui.host.hidden=this.ui.hidden;}}catch(error){if(generation===this.generation)this.options.onError?.(error);}
    if(generation!==this.generation)return;this.lastCommand=commandIndex;
    const scene:any=readScene(this.story,commandIndex,this.options.library.skeletons||[],this.options.library.images||[]);
    this.ui.setMode(scene.model?.engine==='video'?'video':'normal');
    this.fullText=cleanText(line.args[1]);this.ui.line(line.args[0]||'',this.fullText);
    this.position.textContent=`${this.cursor+1} / ${this.indices.length}`;this.previous.disabled=this.cursor===0;this.ui.next.disabled=false;this.toolbar.next.disabled=false;this.toolbar.restart.disabled=false;
    try{localStorage.setItem(this.options.positionKey,String(this.cursor));}catch{}
    if(!live){
      await this.setBackground(scene.image,scene.background);if(generation!==this.generation)return;
      await this.showActors((scene.actors||[]).filter(a=>a.file),generation,instant);if(generation!==this.generation)return;
      this.setMusic(scene.music);this.soundToken=scene.sound?.token;this.sound.pause();
      try{await this.setVideo(scene,generation);}catch{if(generation===this.generation)this.options.onError?.(new Error('剧情视频未能加载。'));}
    }else for(const [key,view]of this.actors)view.actor.talking=!!scene.actors?.find(a=>a.key===key)?.talking;
    if(generation!==this.generation)return;this.playing=false;this.fast=false;this.playVoice();this.typeText(instant||this.skip||this.ui.config.instant);this.queueAuto();
  }
  typeText(instant){
    this.typing=!instant;let at=instant?this.fullText.length:0;const generation=this.generation;
    const tick=()=>{if(generation!==this.generation)return;this.ui.text.textContent=this.fullText.slice(0,at);if(at>=this.fullText.length){this.typing=false;return;}at++;this.typeTimer=setTimeout(tick,Math.max(8,65-this.ui.config.speed*6));};tick();
  }
  reveal(){if(!this.typing)return false;clearTimeout(this.typeTimer);this.typing=false;this.ui.text.textContent=this.fullText;return true;}
  async end(){
    if(this.ended)return;this.ended=true;this.playing=true;this.voice.pause();this.talking(false);this.setAuto(false);this.setSkip(false);const generation=this.generation;
    try{if(this.story.programVersion===3){await this.executeRange(this.lastCommand+1,this.story.commands.length,generation);await Promise.all(this.pending);}}catch(error){if(generation===this.generation)this.options.onError?.(error);}
    if(generation!==this.generation)return;this.playing=false;this.fast=false;this.ui.next.disabled=true;this.toolbar.next.disabled=true;this.position.textContent=`${this.indices.length} / ${this.indices.length} · 已结束`;
  }
  restart(){if(!this.story||this.destroyed)return;this.setAuto(false);this.setSkip(false);this.ui.closeModal();this.ui.hide(false);this.cursor=0;return this.showLine(true);}
  next(){if(this.ui.modal||this.movieWaiting)return;if(this.ui.dismissTitle())return;if(this.ui.hidden){this.ui.hide(false);return;}if(this.playing){this.fast=true;this.finishAnimations();return;}if(this.reveal())return;if(this.cursor<this.indices.length-1){this.cursor++;this.showLine();}else this.end();}
  setAuto(value){this.auto=value;this.ui.active('auto',value);if(value){this.skip=false;this.ui.active('skip',false);}this.queueAuto();}
  setSkip(value){this.skip=value;this.ui.active('skip',value);if(value){this.auto=false;this.ui.active('auto',false);this.voice.pause();this.reveal();}this.queueAuto();}
  queueAuto(){clearTimeout(this.timer);if(this.destroyed||document.hidden||(!this.auto&&!this.skip)||this.ui.modal||this.ui.hidden)return;this.timer=setTimeout(()=>{if(this.playing||this.typing||this.ui.title||!this.voice.paused&&!this.skip)this.queueAuto();else this.next();},this.skip?100:1000);}
  fail(error){this.ui.line('',error.message);this.ui.text.setAttribute('role','alert');}
  destroy(){this.destroyed=true;this.generation++;this.toolbar.destroy();this.finishAnimations();this.effects.destroy();this.captured=null;clearTimeout(this.timer);clearTimeout(this.typeTimer);this.events.abort();this.observer.disconnect();this.director?.destroy();for(const view of this.actors.values())view.player?.destroy();this.actors.clear();for(const audio of [this.voice,this.music,this.sound]){audio.pause();audio.removeAttribute('src');}this.ui.destroy();this.container.replaceChildren();}
}
