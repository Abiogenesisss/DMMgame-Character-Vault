import profile from './profile.ts';
import {Player} from './spine-player.ts';
import {LegacyStoryPlayer} from './legacy-story-player.ts';
globalThis.CharacterVault.register('flower-knight-girl',{...profile,Player,createStoryPlayer:(host,options)=>new LegacyStoryPlayer(host,options)});
