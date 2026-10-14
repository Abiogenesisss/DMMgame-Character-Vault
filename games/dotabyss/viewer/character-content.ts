'use strict';
const contentHelpers=require('./content.ts');
const validId=value=>typeof value==='string'&&/^1\d{8}$/.test(value);
function prepareLibrary(library){
  if(library.rosterVersion===1)return library;
  const source=library.characters||[],byId=new Map<any, any>(source.map(c=>[c.id,c])),families=new Map(),aliases={};
  // DOTABYSS's last three resource digits are the costume slot. A separate
  // unit (including swimsuit units) has its own ...000 ID. Never group names.
  for(const character of source){
    const base=character.id.slice(0,-3)+'000',owner=!character.id.endsWith('000')&&byId.has(base)?base:character.id;
    if(owner!==character.id)aliases[character.id]=owner;
    if(!families.has(owner))families.set(owner,[]);families.get(owner).push(character);
  }
  const characters=[...families].map(([id,members])=>{
    const base=byId.get(id),skins=members.filter(c=>c.id!==id).sort((a,b)=>a.id.localeCompare(b.id)),variants=[base,...skins];
    const label=skin=>'皮肤 '+Number(skin.id.slice(-3)),merge=key=>variants.flatMap(c=>(c[key]||[]).map(item=>c.id===id?item:{...item,variantId:c.id,label:label(c)+' · '+(item.label||(key==='cg'?'CG':'立绘')),phase:c.id+':'+item.phase}));
    // Missing catalog evidence is not a confirmed release status. Use catalog
    // availability, not downloaded files, so clearing media cannot change it.
    const releaseUnconfirmed=variants.every(c=>c.storyAvailable===false&&c.voiceAvailable===false&&c.cgAvailable===false);
    return {...base,releaseUnconfirmed,memberIds:variants.map(c=>c.id),skins:skins.map(c=>({...c,label:label(c),name:base.name+' · '+label(c)})),
      portraits:merge('portraits'),cg:merge('cg'),motions:variants.flatMap(c=>c.motions||[]),stories:[...new Set(variants.flatMap(c=>c.stories||[]))],
      collected:variants.some(c=>c.collected),hasDynamicCg:variants.some(c=>c.hasDynamicCg),cgAvailable:variants.some(c=>c.cgAvailable),storyAvailable:variants.some(c=>c.storyAvailable),
      portraitTotal:variants.reduce((total,c)=>total+(c.portraitTotal||0),0)};
  });
  return {...library,rosterVersion:1,characters,aliases};
}
function readFavorites(value,library){try{const values=JSON.parse(value||'[]');return new Set(Array.isArray(values)?values.filter(validId).map(id=>library?.aliases?.[id]||id):[]);}catch{return new Set<string>();}}
function readRoute(hash,library){const [tab,id,section]=String(hash||'').replace(/^#/,'').split('/');return {tab:['characters','favorites'].includes(tab)?tab:'characters',id:['characters','favorites'].includes(tab)&&validId(id)?library?.aliases?.[id]||id:null,section:['stories','voices'].includes(section)?section:'presentation'};}
function catalogCharacters(library,filter: any={}){
  const query=String(filter.query||'').trim().toLowerCase();
  return contentHelpers.catalogCharacters(library,{...filter,query:''}).filter(c=>!query||[c.name,c.id,c.releaseUnconfirmed?'未实装 实装待确认':'',...(c.skins||[]).flatMap(s=>[s.id,s.name])].join(' ').toLowerCase().includes(query));
}
function roleContent(library,character){
  const content=contentHelpers.roleContent(library,character),ids=new Set<string>(character.memberIds||[character.id]),skinLabels=new Map<any, any>((character.skins||[]).map(s=>[s.id,s.label]));
  return {...content,stories:content.stories.filter(story=>story.hasCg===true).map(story=>skinLabels.has(story.character)?{...story,title:skinLabels.get(story.character)+' · '+story.title}:story),
    voices:(library.audio||[]).filter(item=>ids.has(item.character)&&item.context==='character'&&item.file),
    motions:(library.skeletons||[]).filter(item=>ids.has(item.character)&&item.kind==='cg'&&item.file).map(item=>skinLabels.has(item.character)?{...item,label:skinLabels.get(item.character)+' · 动态 CG'}:item)};
}
export ={...contentHelpers,prepareLibrary,catalogCharacters,readFavorites,readRoute,roleContent};
