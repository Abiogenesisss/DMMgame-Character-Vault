import profile from './profile.ts';
import { MinashigoStoryPlayer } from './story-player.ts';
globalThis.CharacterVault.register('minashigo-x', { ...profile, storyHostId: 'minashigo-reader', storyEngine: () => 'minashigo', createStoryPlayer: (host, options, metadata) => new MinashigoStoryPlayer(host, { ...options, metadata }) });
