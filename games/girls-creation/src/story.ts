'use strict';
const path=require('node:path');
const {csvRows}=require('./csv.ts');
function parseStory(bytes,name,catalog){
  if(bytes.length>8*1024*1024)throw new Error('剧情脚本过大。');
  const rows=csvRows(new TextDecoder('utf8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
  const stem=path.posix.basename(name,'.dmm'),definition=catalog.storyDefinitions?.[name];
  const character=definition?.characters?.[0]||/^h[ms][nr]_(40[12]\d{4})[1-9]$/.exec(stem)?.[1];
  if(!character)throw new Error('剧情归属无法确认。');
  const assets=new Set([name]),commands=[],names={},movies=new Set<string>(),actors=new Map();
  const available=Object.keys(catalog.assets),bank=name.replace(/\.dmm$/,'_voice.dmm');
  const use=name=>{if(name&&catalog.assets[name]){assets.add(name);return name;}return null;};
  const find=(code,pattern)=>{const found=available.filter(n=>pattern.test(n)&&path.posix.basename(n,'.dmm')===code);return found.length===1?use(found[0]):null;};
  const number=(value,fallback=0)=>value!==''&&value!=null&&Number.isFinite(Number(value))?Number(value):fallback;
  const emitActor=(actor,operation,extra={})=>{if(actor)commands.push({command:'actor',args:[{...actor},operation,extra]});};
  use(bank);let title=definition?.title||null,voice=null,sequence=0;
  for(const [command,...args] of rows){
    const token=sequence++;
    const verb=command.replace(/^async/,'');
    const timing={async:command.startsWith('async'),token};
    if(verb==='title'){title=args[0];commands.push({command:'title',args:[title]});}
    else if(['bg','CrossFade','TransitionCrossFade'].includes(verb)){
      const at=verb==='bg'?1:verb==='CrossFade'?2:3;
      commands.push({command:'image',args:[find(args[0],/^notinit\/image_novel_background\//),{x:number(args[at]),y:number(args[at+1]),scaleX:number(args[at+2],1),scaleY:number(args[at+3],1)}]});
      if(verb!=='bg')commands.push({command:'crossfade',args:[{...timing,duration:number(args[verb==='CrossFade'?1:2]),mask:verb==='TransitionCrossFade'?find(args[1],/^notinit\/image_novel_transition\//):null}]});
    }
    // Ready captures the old scene, then releases its Spine/object bank before
    // the new cast is created. Clearing at CrossFade itself would erase new actors.
    else if(verb==='CrossFadeReady'||verb==='TransitionCrossFadeReady'){actors.clear();commands.push({command:'capture',args:[]});}
    else if(verb==='chara'){
      const id=/^st(\d{7})$/.exec(args[0])?.[1],role=catalog.characters.find(c=>c.id===id);
      const reference=use('notinit/standing_spine/'+args[0]+'.dmm')||role?.portraits.find(n=>n.startsWith('image_'));
      if(reference){use(reference);const alpha=number(args[7],1);actors.set(args[1],{id,key:args[1],reference,x:number(args[2]),y:number(args[3]),z:number(args[4]),scaleX:number(args[5],1),scaleY:number(args[6],1),offset:args[8]==='on',alpha,visible:alpha>0,animation:'loop',expression:'loop',loop:true,token});emitActor(actors.get(args[1]),'add',timing);}
    }else if(verb==='charadelete'){actors.delete(args[0]);commands.push({command:'actor_delete',args:[args[0]]});}
    else if(verb==='charafade'){const actor=actors.get(args[0]);if(actor){const from=actor.alpha;actor.visible=args[1]!=='out';actor.alpha=actor.visible?1:0;actor.fade={duration:number(args[2]),token};emitActor(actor,'fade',{...timing,duration:number(args[2]),from});}}
    else if(verb==='charamotion'){const actor=actors.get(args[0]);if(actor){Object.assign(actor,{animation:args[1]||'loop',expression:args[1]||'loop',loop:args[2]!=='off',token});emitActor(actor,'pose',timing);}}
    else if(verb==='charaexpression'){const actor=actors.get(args[0]);if(actor){actor.expression=args[1]||'loop';actor.token=token;emitActor(actor,'pose',timing);}}
    else if(verb==='moveobject'&&args[0]==='character'){const actor=actors.get(args[1]);if(actor){actor.move={from:{x:actor.x,y:actor.y},duration:number(args[2]),easing:args[6]||'linear',token};actor.x=number(args[3],actor.x);actor.y=number(args[4],actor.y);actor.z=number(args[5],actor.z);emitActor(actor,'move',{...timing,...actor.move});}}
    else if(verb==='scaleobject'&&args[0]==='character'){const actor=actors.get(args[1]);if(actor){const from={scaleX:actor.scaleX,scaleY:actor.scaleY};actor.scaleX=number(args[3],actor.scaleX);actor.scaleY=number(args[4],actor.scaleY);emitActor(actor,'scale',{...timing,from,duration:number(args[2]),easing:args[5]});}}
    else if(['jump','shake'].includes(verb)&&args[0]==='character')emitActor(actors.get(args[1]),verb,{...timing,amount:number(args[2]),duration:number(args[3]),count:number(args[4],1)});
    else if(verb==='window')commands.push({command:'window',args:[args[0]!=='off',number(args[1])]});
    else if(verb==='wait')commands.push({command:'wait',args:[number(args[0])]});
    else if(verb==='await')commands.push({command:'await',args:[]});
    else if(verb==='bgmplay')commands.push({command:'music',args:[find(args[0],/^sound\/bgm\//)]});
    else if(verb==='bgmstop')commands.push({command:'music',args:[null]});
    else if(verb==='seplay')commands.push({command:'sound',args:[find(args[0],/^sound\/(?:se|novel_se)\//)]});
    else if(verb==='sestop')commands.push({command:'sound',args:[null]});
    else if(verb==='fade'||verb==='TransitionFade'){const at=verb==='fade'?0:1;commands.push({command:'transition',args:[{...timing,direction:args[at],color:args[at+1],duration:number(args[at+2]),mask:at?find(args[0],/^notinit\/image_novel_transition\//):null}]});}
    else if(verb==='voice')voice=bank+'#'+args[0];
    else if(verb==='playmovie'){
      const code=args[0];
      if(!/^e[sm]m_40[12]\d{5}_\d+$/.test(code))continue;
      const found=available.filter(n=>new RegExp('(?:^|/)'+code+'\\.(?:mp4|webm)$').test(n));
      const bundle=name.replace(/\.dmm$/,'_image.dmm');
      movies.add(code);const reference=found.length===1?use(found[0]):use(bundle)?bundle+'#'+code:null;
      commands.push({command:'movie',args:[{...timing,reference,name:code,mode:args[1]||'once'}]});
    }else if(verb==='stopmovie')commands.push({command:'movie',args:[{reference:null}]});
    else if(verb==='message'||verb==='msgvoicesync'){
      const sync=verb==='msgvoicesync',speaker=args[sync?1:0]||'',text=args[sync?2:1]||'';
      if(sync){voice=bank+'#'+args[4];const actor=actors.get(args[0]);if(actor?.id===character&&speaker&&!/[<>]/.test(speaker))names[character]=speaker;}
      commands.push({command:'actors',args:[[...actors.values()].filter(a=>a.visible).map(a=>({...a,talking:sync&&actors.get(args[0])===a}))]});
      commands.push({command:'mess',args:[speaker,text,voice]});voice=null;
    }
  }
  if(!commands.some(c=>c.command==='mess'))throw new Error('剧情没有可识别的对白。');
  return {name,id:definition?.id||stem,character,characters:definition?.characters||[character],title,commands,names,assets:[...assets],movies:[...movies],adult:/\/h[ms]r_/.test(name)};
}
export { parseStory };
