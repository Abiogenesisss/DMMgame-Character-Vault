import profile from './profile.ts';
import {Player} from './spine-player.ts';
import {FlowerStoryPlayer} from './story-player.ts';
globalThis.CharacterVault.register('flower-knight-girl',{...profile,Player,storyHostId:'flower-reader',storyEngine:()=> 'flower',createStoryPlayer:(host,options)=>new FlowerStoryPlayer(host,options)});
