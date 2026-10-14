import profile from './profile.ts';
import {Player} from './player.ts';
import {DotabyssStoryPlayer} from './story-player.ts';
globalThis.CharacterVault.register('dotabyss',{...profile,Player,storyHostId:'dotabyss-reader',storyEngine:()=> 'dotabyss',createStoryPlayer:(host,options)=>new DotabyssStoryPlayer(host,options)});
