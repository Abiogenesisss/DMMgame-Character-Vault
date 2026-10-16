const validId = id => typeof id === 'string' && /^40[12]\d{4}$/.test(id);
let catalogKind = 'artist';
export const setCatalogKind = kind => { catalogKind = kind === 'impression' ? 'impression' : 'artist'; };
export const getCatalogKind = () => catalogKind;

export function catalogCharacters(library, { tab='characters', favorites=new Set<string>(), query='', availability='all', rarity='all', dynamicOnly=false, kind=catalogKind }: any={}) {
  const search=query.trim().toLowerCase();
  return (library.characters||[]).filter(character=>(kind==='all'||character.kind===kind)
    &&(tab!=='favorites'||favorites.has(character.id))&&(!dynamicOnly||character.hasDynamicCg)
    &&(availability!=='saved'||character.collected)&&(availability!=='missing'||!character.collected)
    &&(rarity==='all'||(rarity==='unknown'?character.rarityId==null:String(character.rarityId)===String(rarity)))
    &&(!search||[character.id,character.name,character.shortName,character.subtitle].join(' ').toLowerCase().includes(search)));
}
export function readFavorites(value,library){try{const items=JSON.parse(value||'[]');return new Set(Array.isArray(items)?items.map(id=>library?.aliases?.[id]||id).filter(validId):[]);}catch{return new Set<string>();}}
export function readRoute(hash,library=null){
  const [tab,id,section]=String(hash||'').replace(/^#/,'').split('/'),canonical=library?.aliases?.[id]||id;
  const role=library?.characters?.find(c=>c.id===canonical);
  if(role)setCatalogKind(role.kind);
  return {tab:['characters','favorites'].includes(tab)?tab:'characters',id:['characters','favorites'].includes(tab)&&validId(canonical)?canonical:null,section:['stories','voices'].includes(section)?section:'presentation'};
}
export const routeHash=(tab,id,section='presentation')=>'#'+tab+(id?'/'+id+'/'+section:'');
export const portraitStatus=character=>character.portraits?.length?'已保存 '+character.portraits.length+' 项立绘/插画':'当前角色尚未保存立绘。';
export function roleContent(library,character){
  return {portraits:(character.portraits||[]).filter(x=>x.file),cg:(character.cg||[]).filter(x=>x.file),
    voices:(library.audio||[]).filter(x=>x.character===character.id&&x.context==='character'&&x.file),
    stories:(library.stories||[]).filter(x=>x.file&&character.stories?.includes(x.id)),
    motions:(library.skeletons||[]).filter(x=>(x.character===character.id||x.characters?.includes(character.id))&&x.kind==='cg'&&x.file)};
}
export function prepareLibrary(library){
  const characters=(library.characters||[]).filter(c=>validId(c.id)).map(c=>({...c,kind:c.kind||(c.id.startsWith('402')?'impression':'artist')}));
  const ids=new Set(characters.map(c=>c.id)),aliases={};
  for(const [old,id]of Object.entries<any>(library.legacyAliases||{}))if(!validId(old)&&ids.has(id))aliases[old]=id;
  return {...library,characters,aliases};
}
