import {StoryParticles} from './story-particles.ts';
import {paintText} from './native-ui.ts';
const n=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const px=v=>`calc(${v} * var(--native-unit))`;
const el=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;return node;};
const enabled=v=>/^(on|true|1)$/i.test(v||'');
// The portrait export retains each sprite's padded Image rectangle and its
// inherited transform. Expressions replace layers, never stretch a face crop.
export class StoryScene{
  declare player: any;
  declare actors: any;
  declare images: any;
  declare loaded: any;
  declare root: any;
  declare imagesRoot: any;
  declare effects: any;
  declare overlay: any;
  declare snapshot: any;
  declare camera: any;

  constructor(player){this.player=player;this.actors=new Map();this.images=new Map();this.loaded=new Map();this.root=el('div','dotabyss-actors');this.imagesRoot=el('div','dotabyss-scene-images');this.effects=el('div','dotabyss-effects');player.camera.prepend(this.imagesRoot,this.root);player.camera.append(this.effects);this.overlay=el('div','dotabyss-text-overlay');this.overlay.hidden=true;player.stage.append(this.overlay);}
  reset(){this.snapshot?.remove();this.snapshot=null;for(const value of this.actors.values())value.el.remove();for(const value of this.images.values())value.particles?.destroy();this.actors.clear();this.images.clear();this.imagesRoot.replaceChildren();this.effects.replaceChildren();this.overlay.hidden=true;this.camera={x:0,y:0,scale:1};this.player.back.style.cssText='';
    // Novel.unity uses a centered 2744-square Image inside its 1920x1080
    // viewport, leaving room for BACK moves without exposing the stage.
    const [width,height]=this.player.nativeData?.background?.size||[2744,2744];
    Object.assign(this.player.back.style,{inset:'auto',left:px((1920-width)/2),top:px((1080-height)/2),width:px(width),height:px(height)});
  }
  async actor(id){
    if(this.actors.has(id))return this.actors.get(id);const spec=this.player.story.actors?.[id];if(!spec?.file)throw new Error('剧情立绘尚未保存，请更新完整剧情。');
    const token=this.player.token;let data;
    if(spec.scene){if(!this.loaded.has(spec.scene))this.loaded.set(spec.scene,fetch(this.player.asset(spec.scene)).then(r=>{if(!r.ok)throw new Error('剧情表情素材读取失败。');return r.json();}).catch(e=>{this.loaded.delete(spec.scene);throw e;}));data=await this.loaded.get(spec.scene);}
    if(token!==this.player.token)return null;
    const root=el('div','dotabyss-actor'),body=el('div','dotabyss-actor-body');root.append(body);root.hidden=true;this.root.append(root);
    const actor={el:root,body,x:0,y:0,scale:1,face:'Normal',closed:false,pose:0,layers:[],anchors:data?.anchors||{}};
    const layers=data?.layers||[{file:spec.file,x:-420,y:-400,width:840,height:900,active:true,name:'Body'}];
    for(const layer of layers){const image=el('img','dotabyss-actor-layer');image.src=this.player.asset(layer.file);image.alt='';Object.assign(image.style,{left:px(layer.x),top:px(layer.y),width:px(layer.width),height:px(layer.height)});body.append(image);actor.layers.push({...layer,el:image});}
    this.actors.set(id,actor);this.face(actor);this.place(actor);return actor;
  }
  place(actor,duration=0,instant=true){return this.player.animate(actor.el,{left:px(960+actor.x),top:px(540-actor.y),transform:`scale(${actor.scale*.5})`},duration,instant);}
  face(actor){for(const layer of actor.layers){const match=/\/FaceContent\/([^/]+)(\/Closed)?$/.exec(layer.name),pose=/\/Pose(\d+)?\//.exec(layer.name);let show=layer.active;if(match)show=match[1]===actor.face&&(actor.closed?!!match[2]||!actor.layers.some(l=>l.name===layer.name+'/Closed'):!match[2]);if(pose&&n(pose[1])!==actor.pose)show=false;layer.el.hidden=!show;}}
  target(type,id?: any){if(type==='CHARA')return this.actors.get(id)?.el;if(type==='SUBIMAGE'||type==='EFFECT')return this.images.get(id)?.el;if(type==='BACK')return this.player.back;return this.player.camera;}
  async image(id,resource,{hidden=false,effect=false,opacity=1}: any={}){const file=this.player.story.resources[resource];if(!file)return null;this.images.get(id)?.el.remove();const image=el('img','dotabyss-scene-image');image.src=this.player.asset(file);image.alt='';image.hidden=hidden;Object.assign(image.style,{left:'0',top:'0',width:'100%',height:'100%',objectFit:effect?'contain':'cover',opacity:String(Math.max(0,Math.min(1,opacity)))});(effect?this.effects:this.imagesRoot).append(image);this.images.set(id,{el:image,x:0,y:0,sx:1,sy:1});return image;}
  async shake(target,x,y,seconds,cycles,instant){if(!target||instant||!target.animate)return;const frames=[];for(let i=0;i<Math.min(80,Math.max(2,cycles*4));i++)frames.push({translate:`${i%2?x:-x}px ${i%3?y:-y}px`});frames.push({translate:'0 0'});const animation=target.animate(frames,{duration:Math.max(0,seconds)*1000});this.player.animations.add(animation);await animation.finished.catch(()=>{});this.player.animations.delete(animation);animation.cancel();}
  async execute(action,{instant=false,silent=false,time=0}: any={}){
    const p=this.player,a=action.args,op=action.op;
    if(op==='crossfadeready'||op==='transitionCrossFadeReady'){this.snapshot?.remove();this.snapshot=el('div','dotabyss-scene-snapshot');this.snapshot.append(p.back.cloneNode(true),p.camera.cloneNode(true));p.stage.append(this.snapshot);return true;}
    if(op==='crossfade'||op==='transitionCrossFade'){const snapshot=this.snapshot;if(snapshot){await p.animate(snapshot,{opacity:'0'},n(a[op==='crossfade'?0:1]),instant);snapshot.remove();if(this.snapshot===snapshot)this.snapshot=null;}return true;}
    if(['live2dinit','initend','cleanskip'].includes(op))return true;
    if(op==='charaload'){await this.actor(a[0]);return true;}
    if(op.startsWith('chara')&&!['charafocuson','charafocusonall'].includes(op)){
      const actor=this.actors.get(a[0]);if(!actor)return true;
      if(op==='charamove'){const field=a[2]==='X'?'x':'y';actor[field]=/Add|Relative/i.test(a[1])?actor[field]+n(a[3]):n(a[3]);await this.place(actor,n(a[4]),instant);}
      else if(op==='charascale'){actor.scale=n(a[1],1);await this.place(actor,n(a[2]),instant);}
      else if(op==='charaface'){if(/^Face/.test(a[1]))actor.face=a[1].slice(4);else if(/^Eye/.test(a[1]))actor.closed=/Clos|Shut/i.test(a[1]);this.face(actor);}
      else if(op==='charapose'){actor.pose=Math.max(0,n(a[1])-1);this.face(actor);}
      else if(op==='charaitem'){for(const layer of actor.layers.filter(l=>/Item/.test(l.name))){layer.el.style.translate=`${px(n(a[1]))} ${px(-n(a[2]))}`;layer.el.style.scale=String(n(a[3],1));}}
      else if(['charashow','charashowalpha','charahide'].includes(op)){actor.el.hidden=false;p.camera.hidden=false;const opacity=op==='charahide'?0:op==='charashowalpha'?n(a[1],1):1;await p.animate(actor.el,{opacity:String(opacity)},n(a[op==='charashowalpha'?2:1]),instant);actor.el.hidden=opacity===0;}
      else if(op==='charafocusonall')for(const value of this.actors.values())value.body.style.filter='';
      else if(op==='charaColor')actor.body.style.filter=`brightness(${Math.max(n(a[2],255),n(a[3],255),n(a[4],255))/255})`;
      else if(op==='charaMask')actor.body.style.clipPath=`inset(0 ${px(Math.max(0,1024-n(a[1])/2))} 0)`;
      else if(op==='charareaction')await this.shake(actor.body,0,a[1]==='Nod'?8:a[1]==='Hop'?20:40,n(a[2],.5),1,instant);
      else if(op==='charaemo'){
        const file=p.story.resources[action.resource];if(file){const key='emotion:'+a[0],spec=p.story.emotions?.[action.resource],anchor=actor.anchors.emotion||{x:0,y:0,scale:[1,1]},origin=spec?.origin||[-75,-75];
          this.images.get(key)?.el.remove();const host=el('div','dotabyss-emotion'),image=el('img','dotabyss-scene-image');image.src=p.asset(file);image.alt='';
          Object.assign(host.style,{position:'absolute',left:px(anchor.x),top:px(anchor.y),width:'0',height:'0',transform:`scale(${anchor.scale[0]},${anchor.scale[1]})`,transformOrigin:'0 0'});
          Object.assign(image.style,{left:px(origin[0]),top:px(origin[1]),width:px(spec?.width||150),height:px(spec?.height||150)});host.append(image);actor.body.append(host);this.images.set(key,{el:host});
        }
      }
      return true;
    }
    if(op==='charafocuson'||op==='charafocusonall'){for(const [id,actor]of this.actors)actor.body.style.filter=op==='charafocusonall'||id===a[0]?'':'brightness(.6)';return true;}
    if(op==='emodelete'){this.images.get('emotion:'+a[0])?.el.remove();this.images.delete('emotion:'+a[0]);return true;}
    if(op==='silhouette'){const actor=this.actors.get(a[0]);if(actor)actor.body.style.filter=enabled(a[1])?'brightness(0)':'';return true;}
    if(op==='changematerial'){const actor=this.actors.get(a[1]);if(actor)actor.body.style.filter=a[0]==='NORMAL'?'':`blur(${px(n(a[2])*100)})`;return true;}
    if(op==='priority'){const target=this.target(a[1],a[0]);if(target)target.style.zIndex=String(n(a[2])+1);return true;}
    if(op==='bg'){const file=p.story.resources[action.resource];if(!file)throw new Error('剧情背景尚未保存，请更新完整剧情。');p.back.src=p.asset(file);p.back.hidden=false;return true;}
    // The third field is initial alpha. Black transition sprites are loaded
    // with alpha 0 and remain invisible until a later subimagefade command.
    if(op==='subimage'){await this.image(a[1],action.resource,{opacity:n(a[2],1)});p.camera.hidden=false;return true;}
    if(op==='subimagefade'){const image=this.images.get(a[0])?.el;if(image){image.style.opacity=String(n(a[1]));await p.animate(image,{opacity:String(n(a[2]))},n(a[3]),instant);}return true;}
    if(op==='subimagedelete'||op==='prefabdeleteui'){const image=this.images.get(a[0]);image?.particles?.destroy();image?.el.remove();this.images.delete(a[0]);return true;}
    if(op==='prefabloadUI'||op==='prefabshowAll'){
      const spec=p.story.effects?.[action.resource];if(spec){const token=p.token,response=await fetch(p.asset(spec.file));if(!response.ok)throw new Error('剧情粒子素材读取失败。');const data=await response.json();if(token!==p.token)return true;
        const host=el('div','dotabyss-effects');this.effects.append(host);host.hidden=op==='prefabloadUI';const old=this.images.get(a[0]);old?.particles?.destroy();old?.el.remove();const value: { el: any; data: any; start: any; particles?: any; }={el:host,data,start:time};this.images.set(a[0],value);if(!host.hidden){value.particles=new StoryParticles(host,data,{asset:p.asset,clock:()=>p.engine.time,start:time});await value.particles.ready;}
      }else await this.image(a[0],action.resource,{effect:true,hidden:op==='prefabloadUI'});return true;
    }
    if(op==='prefabshowUI'){const image=this.images.get(a[0]);if(image){image.el.hidden=a[1]==='OFF';if(image.data&&!image.el.hidden&&!image.particles){image.particles=new StoryParticles(image.el,image.data,{asset:p.asset,clock:()=>p.engine.time,start:time});await image.particles.ready;}}return true;}
    if(op==='prefabhideall'){for(const value of this.images.values())if(value.el.parentNode===this.effects){value.particles?.destroy();value.particles=null;value.el.hidden=true;}return true;}
    if(op==='item'){if(enabled(a[0]))await this.image('item',action.resource,{effect:true});else{this.images.get('item')?.el.remove();this.images.delete('item');}return true;}
    if(op==='move'||op==='scale'){const target=this.target(a[0],a[1]);if(target){const x=n(a[3],op==='scale'?1:0),y=n(a[4],op==='scale'?x:0);await p.animate(target,op==='move'?{translate:`${px(x)} ${px(-y)}`}:{scale:`${x>10?x/100:x} ${y>10?y/100:y}`},n(a[2]),instant);}return true;}
    if(op==='cameramove'||op==='camerazoom'){if(op==='cameramove')this.camera[a[1]==='Y'?'y':'x']=n(a[2]);else this.camera.scale=n(a[0],1);await p.animate(p.camera,{transform:`translate(${px(this.camera.x)},${px(-this.camera.y)}) scale(${this.camera.scale})`},n(a[op==='cameramove'?3:1]),instant);return true;}
    if(op==='blur'){const target=this.target(a[1]);await p.animate(target,{filter:enabled(a[0])?'blur(8px)':'none'},n(a[2]),instant);return true;}
    if(op==='jump'||op==='shake'||op==='shakeall'){const all=op==='shakeall',target=all?p.camera:this.target(a[0],a[1]);await this.shake(target,op==='jump'?0:n(a[all?0:2])*(p.stage.getBoundingClientRect().width/1920||.5),n(a[all?1:op==='jump'?2:3])*(p.stage.getBoundingClientRect().width/1920||.5),n(a[op==='jump'?3:4],.5),n(a[all?3:op==='jump'?4:5],1),instant);return true;}
    if(op==='shakeallstop'){for(const animation of p.animations)animation.cancel();return true;}
    if(op==='bgcolor'){p.back.style.filter=`brightness(${Math.max(n(a[0],255),n(a[1],255),n(a[2],255))/255})`;return true;}
    if(op==='popupbgfade'){p.overlay.style.background=`rgb(${a.slice(1,4).map(v=>n(v)).join(',')})`;await p.animate(p.overlay,{opacity:String(n(a[4])/255)},n(a[0]),instant);return true;}
    if(op==='linework'){this.root.style.filter=enabled(a[0])?'contrast(1.1)':'';return true;}
    if(op==='title'){
      const title=p.nativeData?.title,[width,height]=title?.size||[3600,234],style=title?.text||{size:52,outline:.2,horizontal:2,vertical:512};
      this.overlay.style.inset=`${px((1080-height)/2)} ${px((1920-width)/2)}`;
      paintText(this.overlay,a[0]||'',p.nativeData?.fonts?.[style.font]||Object.values<any>(p.nativeData?.fonts||{})[0],style,width,height);this.overlay.hidden=false;return true;
    }
    if(op==='messagetextwindow'){this.overlay.hidden=!enabled(a[0]);return true;}
    if(op==='cleanall'&&a[0]==='EFFECT'){this.effects.replaceChildren();for(const [key,value]of this.images)if(!value.el.isConnected){value.particles?.destroy();this.images.delete(key);}return true;}
    return false;
  }
  destroy(){this.reset();this.root.remove();this.imagesRoot.remove();this.effects.remove();this.overlay.remove();this.loaded.clear();}
}
