'use strict';
// Browser timers require their Window receiver; storing the native functions
// on a player instance makes this.setTimer(...) throw "Illegal invocation".
const scheduleTimer=(callback,delay)=>globalThis.setTimeout(callback,delay);
const cancelTimer=timer=>globalThis.clearTimeout(timer);
function duration(action){const a=action.args;return Math.max(0,Number(a[action.op==='fade'?2:['window','bgmstop','bgvstop','sestop'].includes(action.op)?1:0])||0);}
// Delayed scene triggers select the next main action, rather than a temporary
// expression. Advancing dialogue must commit them before subsequent commands.
const sceneTrigger=action=>action?.op==='l2dmotion'&&/^Scene\d+$/i.test(String(action.args[0]).trim());
class StoryEngine{
  declare labels: any;
  declare program: any;
  declare adapter: any;
  declare now: any;
  declare setTimer: any;
  declare clearTimer: any;
  declare onLine: any;
  declare onEnd: any;
  declare onError: any;
  declare rate: any;
  declare started: any;
  declare offset: any;
  declare pending: any;
  declare operations: any;
  declare generation: any;
  declare cursor: any;
  declare line: any;
  declare waiting: any;
  declare running: any;
  declare ended: any;
  declare lineElapsed: any;
  declare rebuildTime: any;
  declare times: any;
  declare lineTimes: any;
  declare advanceTimes: any;
  declare clickWait: any;

  constructor(program,adapter,{now=()=>performance.now()/1000,setTimer=scheduleTimer,clearTimer=cancelTimer,onLine=()=>{},onEnd=()=>{},onError=()=>{}}: any={}){
    if(program?.version!==2||!Array.isArray(program.commands))throw new Error('剧情脚本格式无效。');
    this.labels=new Map<any, any>(program.commands.flatMap((action,index)=>action.label?[[action.op.slice(1),index+1]]:[]));
    this.program=program;this.adapter=adapter;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;this.onLine=onLine;this.onEnd=onEnd;this.onError=onError;
    this.rate=1;this.started=this.now();this.offset=0;
    this.pending=new Set<string>();this.operations=new Set<string>();this.generation=0;this.cursor=0;this.line=-1;this.waiting=false;this.running=false;this.ended=false;this.lineElapsed=0;
  }
  get time(){return this.rebuildTime??(this.now()-this.started)*this.rate+(this.offset||0);}
  setFastForward(enabled){
    const rate=enabled?8:1;if(rate===this.rate)return;const time=this.time;this.offset=time;this.started=this.now();this.rate=rate;
    // Keep deadlines in script time so release immediately restores normal
    // timing without losing delayed expressions or waiting instructions.
    for(const item of this.pending){this.clearTimer(item.timer);item.timer=this.setTimer(item.complete,Math.max(0,(item.deadline-time)/rate)*1000);}
  }
  cancelPending(stopOnly=false){const cancelled=[];for(const item of [...this.pending])if(!stopOnly||item.mode==='STOP'){this.clearTimer(item.timer);this.pending.delete(item);item.resolve?.(false);cancelled.push(item);}return cancelled;}
  delay(seconds,generation=this.generation,mode='STOP',action=null){
    if(!(seconds>0))return Promise.resolve(true);
    return new Promise(resolve=>{const item: { mode: string; resolve: (value: unknown) => void; action: any; deadline: any; complete?: () => void; timer?: any; }={mode,resolve,action,deadline:this.time+seconds};item.complete=()=>{this.pending.delete(item);resolve(generation===this.generation);};item.timer=this.setTimer(item.complete,seconds/this.rate*1000);this.pending.add(item);});
  }
  async start({line=0}: any={}){
    this.stop();const generation=++this.generation;this.started=this.now();this.offset=0;this.times=new Map();this.lineTimes=new Map();this.advanceTimes=new Map();this.cursor=0;this.line=-1;this.waiting=false;this.ended=false;
    await this.adapter.reset?.();if(generation!==this.generation)return;
    if(line>0)return this.seek(line,generation);
    return this.run(generation);
  }
  stop(){this.generation++;this.cancelPending();this.operations.clear();this.waiting=false;this.running=false;this.rebuildTime=null;this.rate=1;this.adapter.stop?.();}
  async execute(action,{instant=false,silent=false,time=this.time}: any={}){
    return this.adapter.execute(action,{instant,silent,time});
  }
  schedule(action,generation){
    const mode=action.skipMode||'STOP';
    const operation=(async()=>{if(!await this.delay(action.delay||0,generation,mode,action)||generation!==this.generation)return;await this.execute(action);})();
    this.operations.add(operation);operation.catch(error=>{if(generation===this.generation)this.onError(error);}).finally(()=>this.operations.delete(operation));
  }
  async run(generation=this.generation){
    if(this.running||this.ended||generation!==this.generation)return;this.running=true;
    try{
      let steps=0;
      while(this.cursor<this.program.commands.length&&generation===this.generation){
        if(++steps>this.program.commands.length*4+1)throw new Error('剧情脚本出现循环跳转。');
        const action=this.program.commands[this.cursor++];if(action.label)continue;
        if(action.op==='labeljump'){const target=this.labels.get(action.args[0]);if(target===undefined)throw new Error('剧情跳转目标不存在。');this.cursor=target;continue;}
        this.times.set(action.source,this.time);
        if(action.dialogue!==undefined){
          this.line=action.dialogue;this.waiting=true;this.lineTimes.set(this.line,this.time);await this.execute(action);if(generation!==this.generation)return;this.onLine(action,this.line);return;
        }
        if(action.async){this.schedule(action,generation);continue;}
        if(action.op==='wait'||action.op==='waitorclick'){this.clickWait=action.op==='waitorclick';await this.delay(duration(action),generation);this.clickWait=false;continue;}
        if(['asyncwait','asyncstopwait','asyncskipwait'].includes(action.op)){await Promise.all([...this.operations]);continue;}
        await this.execute(action);
      }
      if(generation===this.generation){this.ended=true;this.waiting=false;this.cancelPending();this.adapter.finish?.();this.onEnd();}
    }catch(error){if(generation===this.generation){this.waiting=false;this.onError(error);}}
    finally{if(generation===this.generation)this.running=false;}
  }
  async next(){
    if(this.ended)return;if(this.running){if(this.clickWait)this.cancelPending(true);return;}
    if(this.adapter.reveal?.())return;
    if(!this.waiting){this.cancelPending(true);return;}
    const generation=this.generation;this.advanceTimes.set(this.line,this.time);this.waiting=false;this.running=true;this.adapter.stopVoice?.();
    try{
      for(const item of this.cancelPending(true))if(sceneTrigger(item.action)){if(generation!==this.generation)return;await this.execute(item.action);}
    }catch(error){if(generation===this.generation)this.onError(error);return;}
    finally{if(generation===this.generation)this.running=false;}
    if(generation===this.generation)return this.run(generation);
  }
  async seek(line,generation?: any){
    if(generation===undefined){this.stop();generation=++this.generation;await this.adapter.reset?.();}
    this.cursor=0;this.waiting=false;this.running=true;this.ended=false;
    try{
      let clock=0,target;const replay=[];let delayed=[];
      const flush=until=>{for(const item of delayed.filter(item=>item.time<=until))replay.push(item);delayed=delayed.filter(item=>item.time>until);};
      let steps=0;
      while(this.cursor<this.program.commands.length&&generation===this.generation){
        if(++steps>this.program.commands.length*4+1)throw new Error('剧情脚本出现循环跳转。');
        const action=this.program.commands[this.cursor++];if(action.label)continue;
        if(action.op==='labeljump'){const target=this.labels.get(action.args[0]);if(target===undefined)throw new Error('剧情跳转目标不存在。');this.cursor=target;continue;}
        clock=this.times.get(action.source)??clock;
        flush(clock);
        if(action.dialogue!==undefined){
          clock=this.lineTimes.get(action.dialogue)??clock;flush(clock);
          if(action.dialogue>=line){target=action;break;}
          clock=this.advanceTimes.get(action.dialogue)??clock;flush(clock);
          for(const item of delayed)if(item.action.skipMode!=='CONT'&&sceneTrigger(item.action))replay.push({...item,time:clock});
          delayed=delayed.filter(item=>item.action.skipMode==='CONT');
          continue;
        }
        if(action.async){delayed.push({action,time:clock+(action.delay||0)});continue;}
        if(action.op==='wait'||action.op==='waitorclick'){clock+=duration(action);continue;}
        if(['asyncwait','asyncstopwait','asyncskipwait'].includes(action.op)){clock=Math.max(clock,...delayed.map(item=>item.time));flush(clock);continue;}
        replay.push({action,time:clock});if(['fade','window','bgmstop','bgvstop','sestop'].includes(action.op))clock+=duration(action);
      }
      if(!target)return;this.rebuildTime=clock;
      // Rebuild the state at the selected line, including delayed expression
      // tracks. Recorded read times reproduce a revisit within this session;
      // a restored bookmark uses the script's minimum authored timing.
      for(const item of replay.sort((a,b)=>a.time-b.time||a.action.source-b.action.source)){if(generation!==this.generation)return;await this.execute(item.action,{instant:true,silent:true,time:item.time});}
      if(generation!==this.generation)return;this.offset=clock;this.started=this.now();this.rebuildTime=null;
      for(const item of delayed)this.schedule({...item.action,delay:Math.max(0,item.time-clock)},generation);
      this.line=target.dialogue;this.waiting=true;this.lineTimes.set(this.line,clock);await this.execute(target,{instant:true});if(generation===this.generation)this.onLine(target,this.line);
    }catch(error){if(generation===this.generation)this.onError(error);}
    finally{if(generation===this.generation){this.rebuildTime=null;this.running=false;}}
  }
  previous(){if(this.line>0)return this.seek(this.line-1);}
}
class StoryAudio{
  declare createAudio: any;
  declare asset: any;
  declare now: any;
  declare setTimer: any;
  declare clearTimer: any;
  declare channels: any;
  declare levels: any;

  constructor({createAudio=()=>new Audio(),asset=value=>value,now=()=>performance.now(),setTimer=scheduleTimer,clearTimer=cancelTimer}: any={}){
    this.createAudio=createAudio;this.asset=asset;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;this.channels=new Map();this.levels={voice:1,bgm:1,bgv:1,se:1};
  }
  level(kind,value){this.levels[kind]=Math.min(1,Math.max(0,value));for(const channel of this.channels.values())if(channel.kind===kind)channel.audio.volume=channel.gain*this.levels[kind];}
  ramp(channel,target,seconds){
    if(channel.timer)this.clearTimer(channel.timer);const from=channel.gain,start=this.now();let settled;
    const done=new Promise(resolve=>{settled=resolve;});channel.cancelRamp?.();channel.cancelRamp=settled;
    const step=()=>{const progress=seconds>0?Math.min(1,(this.now()-start)/(seconds*1000)):1;channel.gain=from+(target-from)*progress;channel.audio.volume=Math.min(1,Math.max(0,channel.gain*this.levels[channel.kind]));
      if(progress<1)channel.timer=this.setTimer(step,20);else{channel.timer=null;channel.cancelRamp=null;settled();}};step();return done;
  }
  play(tag,file,{kind='voice',loop=false,fade=0,volume=1}: any={}){
    this.stop(tag);if(!file)return null;const audio=this.createAudio();audio.src=this.asset(file);audio.loop=loop;audio.preload='auto';const channel={audio,kind,gain:fade>0?0:volume,volume};this.channels.set(tag,channel);audio.volume=channel.gain*this.levels[kind];audio.play().catch(()=>{});if(fade>0)this.ramp(channel,volume,fade);return channel;
  }
  async stop(tag,fade=0){const channel=this.channels.get(tag);if(!channel)return;if(fade>0){await this.ramp(channel,0,fade);if(this.channels.get(tag)!==channel)return;}this.channels.delete(tag);if(channel.timer)this.clearTimer(channel.timer);channel.cancelRamp?.();channel.audio.pause();channel.audio.removeAttribute('src');}
  stopAll(){for(const tag of [...this.channels.keys()])this.stop(tag);}
  pauseAll(){for(const channel of this.channels.values()){channel.pausedByPage=!channel.audio.paused&&!channel.audio.ended;channel.audio.pause();}}
  resumeAll(){for(const channel of this.channels.values())if(channel.pausedByPage){channel.pausedByPage=false;channel.audio.play().catch(()=>{});}}
  replayVoice(){const audio=this.channels.get('voice')?.audio;if(audio){audio.currentTime=0;audio.play().catch(()=>{});}}
  get voicePlaying(){const audio=this.channels.get('voice')?.audio;return !!audio&&!audio.paused&&!audio.ended;}
}
export { StoryEngine, StoryAudio };
