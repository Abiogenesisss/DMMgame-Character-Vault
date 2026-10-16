import profile from './profile.ts';
import {Player} from './spine-player.ts';
import {GirlsStoryPlayer} from './story-player.ts';
import {CatalogView} from './catalog-view.ts';
globalThis.CharacterVault.register('girls-creation',{...profile,Player,storyEngine:()=> 'girlscreation',storyHostId:'girlscreation-reader',createView:api=>new CatalogView(api),createStoryPlayer:(host,options)=>new GirlsStoryPlayer(host,options)});
