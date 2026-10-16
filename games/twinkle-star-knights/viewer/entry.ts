import profile from './profile.ts';
import { Player } from './spine-player.ts';
import { StoryPlayer } from './story-player.ts';
globalThis.CharacterVault.register('twinkle-star-knights', { ...profile, Player, storyEngine: () => 'twinkle', createStoryPlayer: (host, options) => new StoryPlayer(host, options) });
