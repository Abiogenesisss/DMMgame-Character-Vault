import {getCatalogKind,setCatalogKind} from './character-content.ts';
const node=(tag,className='',text=''):any=>{const el=document.createElement(tag);el.className=className;if(text)el.textContent=text;return el;};
export class CatalogView{
  constructor(private api){}
  renderCatalog(host,items,{library,selectedRole}){
    host.replaceChildren();if(selectedRole)return;
    const wrap=node('div','gc-catalog'),nav=node('nav','gc-kind-tabs');nav.setAttribute('aria-label','角色类型');
    for(const [kind,label]of [['artist','类型 1'],['impression','类型 2']]){
      const count=library.characters.filter(c=>c.kind===kind).length,button=node('button','secondary-button',label+' · '+count);button.type='button';button.dataset.kind=kind;button.setAttribute('aria-pressed',String(getCatalogKind()===kind));
      button.addEventListener('click',()=>{setCatalogKind(kind);this.api.rerender();host.querySelector('[data-kind="'+kind+'"]')?.focus();});nav.append(button);
    }
    const note=node('p','gc-kind-description',getCatalogKind()==='artist'?'艺术家 · 每张角色卡独立展示':'艺术品拟人 · 每张角色卡独立展示');
    const grid=node('div','gc-character-grid');
    for(const character of items){
      const card=this.api.characterCard(character),picture=card.querySelector('.character-thumbnail');
      card.dataset.kind=character.kind;card.dataset.rarity=character.rarityId||'';
      const frame=character.kind==='artist'?library.characterFrames?.artist:library.characterFrames?.impression?.[character.rarityId];
      if(picture&&frame){const image=node('img','gc-card-frame');image.src=this.api.asset(frame);image.alt='';image.setAttribute('aria-hidden','true');picture.append(image);}
      card.querySelector('.character-caption small').textContent=character.collected?'已保存资源':'尚未获取';
      grid.append(card);
    }
    wrap.append(nav,note,grid);host.append(wrap);
  }
  renderRole(){}
  setBusy(){}
  destroy(){}
}
