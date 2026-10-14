'use strict';
const path=require('node:path');
// R18 chapters are authored as three separate scripts: introduction, CG, coda.
// Keep the former middle-segment id so links and character associations survive.
function completeStories(stories,catalog){
  const groups=new Map(),result=[];
  for(const story of stories){const match=/^hmr_(\d{9})(\d)[123]$/.exec(story.name);if(!match){result.push({...story,segments:[story.address],expectedSegments:[story.address],title:(story.name.startsWith('men_')?'角色小剧场 ':'角色剧情 ')+Number(story.name.slice(-2))});continue;}
    const key=match[1]+match[2];if(!groups.has(key))groups.set(key,[]);groups.get(key).push(story);
  }
  for(const [key,parts]of groups){
    parts.sort((a,b)=>a.name.localeCompare(b.name));const middle=parts.find(p=>p.name.endsWith('2'))||parts[0],name='hmr_'+key+'2';
    const program={...middle.program,commands:[],assets:[],models:{},actors:{},audio:{},unsupported:[],missing:[],dialogue:0,hasCg:parts.some(p=>p.hasCg)};
    const story={...middle,id:'dotabyss-'+name,name,title:'CG 剧情 '+key.slice(-1)+'（完整）',commands:[],program,hasCg:program.hasCg,names:{},characters:[],assets:[],resources:{},voices:{},segments:parts.map(p=>p.address),expectedSegments:(catalog.characters.find(c=>c.id===key.slice(0,9))?.stories||[]).filter(a=>new RegExp('/hmr_'+key+'[123]\\.txt$').test(a)).sort()};
    for(const part of parts){
      const prefix=part.name+':',aliases=new Set(Object.keys(part.program.actors||{}));
      if(program.commands.length)program.commands.push({op:'segment',args:[],source:program.commands.length});
      for(const action of part.program.commands){const next={...action,args:action.args.map(a=>aliases.has(a)?prefix+a:a),source:program.commands.length};
        if(action.label)next.op=':'+prefix+action.op.slice(1);
        if(action.op==='labeljump')next.args=[prefix+action.args[0]];
        if(action.actor)next.actor=prefix+action.actor;
        if(action.dialogue!==undefined)next.dialogue=program.dialogue++;
        program.commands.push(next);
      }
      Object.assign(program.actors,Object.fromEntries(Object.entries<any>(part.program.actors||{}).map(([key,value])=>[prefix+key,value])));
      for(const field of ['models','audio'])Object.assign(program[field],part.program[field]);
      program.unsupported.push(...part.program.unsupported);program.missing.push(...part.program.missing||[]);program.assets.push(...part.program.assets);
      Object.assign(story.names,part.names);story.characters.push(...part.characters);story.commands.push(...part.commands);
    }
    for(const key of ['assets','unsupported'])program[key]=[...new Set<string>(program[key])];story.assets=program.assets;story.characters=[...new Set<string>(story.characters)];result.push(story);
  }
  return result.sort((a,b)=>a.name.localeCompare(b.name));
}
export { completeStories };
