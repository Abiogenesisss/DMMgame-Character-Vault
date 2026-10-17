import profile from './profile.ts';
import {Player} from './spine-player.ts';
import {LegacyStoryPlayer} from './legacy-story-player.ts';
import {MuvStoryPlayer} from './story-player.ts';
import {PortalView} from './portal.ts';
import {activeStyle} from './character-content.ts';
globalThis.CharacterVault.register('muvluv-ggx',{...profile,Player,createView:api=>new PortalView(api),downloadCharacter:activeStyle,storyHostId:'muvluv-reader',storyEngine:metadata=>metadata.programVersion===2?'muvluv':'legacy',createStoryPlayer:(host,options,metadata)=>metadata.programVersion===2?new MuvStoryPlayer(host,{...options,positionKey:options.positionKey+':native-v2'}):new LegacyStoryPlayer(host,options)});
