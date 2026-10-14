'use strict';
function sampleChannel(channel,time){
  if(channel.kind==='constant')return channel.value;
  if(channel.kind==='dense'){const values=channel.values;if(!values?.length)return 0;const frame=Math.max(0,Math.min(values.length-1,(time-(channel.begin||0))*channel.rate)),at=Math.floor(frame);return values[at]+(values[Math.min(at+1,values.length-1)]-values[at])*(frame-at);}
  const keys=channel.keys;if(!keys?.length)return 0;let low=0,high=keys.length;
  while(low<high){const middle=(low+high)>>>1;if(keys[middle][0]<=time)low=middle+1;else high=middle;}
  const [start,[a,b,c,d]]=keys[Math.max(0,low-1)],delta=Math.max(0,time-start);return ((a*delta+b)*delta+c)*delta+d;
}
const family=name=>/^scene\d+/i.test(name)?'scene':(/^(FaceAngle|FaceEmotion|EyeEmotion|EyeOpen|EyebrowEmotion|MouthEmotion|ExEmotion)/i.exec(String(name))?.[1]||String(name).replace(/(?:Reset|\d+(?:_loop)?)$/i,'')).toLowerCase();
class NativeMotionState{
  declare data: any;
  declare names: any;
  declare tracks: any;
  declare controller: any;

  constructor(data){
    if(data?.version!==1||!data.animations||!data.defaults)throw new Error('Live2D 演出数据无效。');
    this.data=data;this.names=new Map(Object.keys(data.animations).map(name=>[name.toLowerCase(),name]));this.tracks=new Map();
    this.controller=data.controller;
  }
  clear(){this.tracks.clear();}
  initialize(time=0){this.clear();for(const key of this.controller?.initial||[]){const state=this.controller.states[key];if(state?.clip)this.tracks.set(state.layer.toLowerCase(),this.track(key,time));}}
  track(key,time,previous?: any,duration?: any){
    const state=this.controller.states[key],motion=this.data.animations[state.clip];
    const timing=duration||this.controller.transitions[previous?.state+'>'+key]||this.controller.anyTransitions[key];
    const fade=timing?Math.max(0,timing.duration*(timing.fixed?1:(this.data.animations[previous?.name]?.duration||1))):0;
    // Both Animator clips continue advancing during a crossfade. A frozen
    // snapshot of the outgoing pose makes an otherwise smooth motion pause.
    return {state:key,name:state.clip,start:time,loop:state.loop,group:state.layer.toLowerCase(),order:state.order,weight:state.weight,additive:state.additive,speed:state.speed||1,next:state.next,from:fade>0?previous:null,fade,release:!motion};
  }
  advance(track,time){
    for(let i=0;i<64&&track.next;i++){
      const motion=this.data.animations[track.name],boundary=track.start+(motion?.duration||0)*track.next.exit/track.speed;
      if(!motion||!(boundary>track.start)||time<boundary)break;
      const next=this.track(track.next.state,boundary,track,track.next);this.tracks.set(track.group,next);track=next;
    }return track;
  }
  contribution(track,time){
    const progress=track.fade>0?Math.min(1,Math.max(0,(time-track.start)/track.fade)):1;
    if(progress>=1)track.from=null;
    const from=track.from?this.contribution(track.from,time):null;
    if(track.release)return from||new Map();
    const motion=this.data.animations[track.name],values=new Map();let elapsed=Math.max(0,time-track.start)*(track.speed||1);
    if(motion){if(track.loop&&motion.duration>0)elapsed%=motion.duration;else elapsed=Math.min(elapsed,motion.duration);
      for(const channel of motion.channels){const value=sampleChannel(channel,elapsed);if(Number.isFinite(value))values.set(channel.id,{id:channel.id,target:channel.target,value});}}
    if(from){
      for(const id of new Set([...from.keys(),...values.keys()])){const before=from.get(id)||this.data.defaults[id],after=values.get(id)||this.data.defaults[id];if(!before||!after)continue;values.set(id,{id,target:after.target,value:before.value+(after.value-before.value)*progress});}
    }return values;
  }
  play(request,{time=0,loop=false}: any={}){
    request=String(request).trim();
    if(this.controller){const key=this.controller.actions[request.toLowerCase()];if(!key)return false;const state=this.controller.states[key];if(state.clip&&!this.data.animations[state.clip])return false;const group=state.layer.toLowerCase();const previous=this.tracks.get(group);this.tracks.set(group,this.track(key,time,previous));return true;}
    if(/Reset$/i.test(request)){
      const group=family(request);
      const channels=Object.entries<any>(this.data.animations).filter(([name])=>family(name)===group).flatMap(([,motion])=>motion.channels);
      if(!channels.length)return false;
      this.tracks.delete(group);
      return true;
    }
    let name=this.names.get(String(request).toLowerCase());
    if(!name&&/^scene\d+$/i.test(request))name=this.names.get(String(request).toLowerCase()+'_loop');
    if(!name)return false;
    const group=family(name);this.tracks.set(group,{name,start:time,loop,group});return true;
  }
  values(time){
    const values=new Map(Object.entries<any>(this.data.defaults).map(([id,value])=>[id,{id,...value}]));
    if(this.controller){
      const tracks=[...this.tracks.values()].map(track=>this.advance(track,time)).sort((a,b)=>a.order-b.order);
      for(const track of tracks){const contribution=this.contribution(track,time),weight=track.weight*(track.release?(track.fade>0?Math.max(0,1-(time-track.start)/track.fade):0):1);
        for(const [id,channel]of contribution){const before=values.get(id)?.value??0,reference=this.data.defaults[id]?.value??0;values.set(id,{...channel,value:track.additive?before+(channel.value-reference)*weight:before+(channel.value-before)*weight});}}
      return [...values.values()];
    }
    const tracks=[...this.tracks.values()].sort((a,b)=>Number(a.group!=='scene')-Number(b.group!=='scene')||a.start-b.start);
    for(const track of tracks){
      let motion=this.data.animations[track.name],elapsed=Math.max(0,time-track.start);
      if(track.group==='scene'&&!/_loop$/i.test(track.name)&&elapsed>=motion.duration){const next=this.names.get(track.name.toLowerCase()+'_loop');if(next){elapsed-=motion.duration;motion=this.data.animations[next];track.start+=this.data.animations[track.name].duration;track.name=next;track.loop=true;}}
      if((track.loop||motion.loop)&&motion.duration>0)elapsed%=motion.duration;else elapsed=Math.min(elapsed,motion.duration);
      for(const channel of motion.channels){const value=sampleChannel(channel,elapsed);if(Number.isFinite(value))values.set(channel.id,{id:channel.id,target:channel.target,value});}
    }
    return [...values.values()];
  }
}
export { NativeMotionState, sampleChannel, family };
