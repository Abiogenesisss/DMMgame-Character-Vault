import { Player } from './spine-player.ts';
import { readScene } from './reader-scene.ts';
import { StoryControls } from '../../../app/viewer/story-controls.ts';
const markup="<div id=\"story-stage\" class=\"story-stage\"><img id=\"story-image\" alt=\"当前剧情 CG\" hidden><div id=\"story-actors\" class=\"story-actors\" hidden></div><div id=\"story-motion\" class=\"story-motion\" hidden></div><span id=\"story-placeholder\">✿</span></div><div class=\"dialogue\"><strong id=\"speaker\"></strong><p id=\"dialogue-text\"></p></div>";
export class LegacyStoryPlayer {
  declare load: any;
  declare fail: any;
  declare destroy: any;

  constructor(container,options){
    container.innerHTML=markup;
    const $=id=>container.querySelector('#'+id),asset=options.asset,library=options.library;
    const notify=message=>options.onError(new Error(message)),characterName=options.characterName;
    const currentSession={path:options.assetRoot.replace(/library\/$/,'')};
    const storyPositionKey=()=>options.positionKey;
    const clean=text=>String(text||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/?(?:color|size|b|i|ruby|rt|font)(?:=[^>]*)?>/gi,'').replace(/\\n/g,'\n');
    const element=<K extends keyof HTMLElementTagNameMap>(tag: K,className?: string,text?: unknown)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=String(text);return node;};
    const voice=new Audio(),storyMusic=new Audio(),storySound=new Audio(),events=new AbortController();storyMusic.loop=true;storyMusic.volume=.45;
    let story=null,dialogueIndices=[],cursor=0,storyGeneration=0,director=null,storyMusicFile=null,storySoundToken=null,storyTransitionToken=null;
    const position=element('span');position.id='story-position';
    const toolbar=new StoryControls(container,{
      previous:()=>{if(cursor>0){cursor--;return showLine();}},
      next:()=>{if(cursor<dialogueIndices.length-1){cursor++;return showLine();}},
      restart:()=>{cursor=0;return showLine();}
    },{className:'reader-controls',position,onError:options.onError});
    toolbar.previous.id='previous-line';toolbar.next.id='next-line';container.append(toolbar.element);
    async function showLine() {
  if (!story || !dialogueIndices.length) return;
  const generation = ++storyGeneration; voice.pause();
  const commandIndex = dialogueIndices[cursor], line = story.commands[commandIndex];
  const speaker = line.args[0] || ''; $('speaker').textContent = speaker.includes('\ufffd') ? characterName(String(story.character).slice(0, 6)) : speaker;
  $('dialogue-text').textContent = clean(line.args[1]); $('story-position').textContent = `${cursor + 1} / ${dialogueIndices.length}`;
  $('previous-line').disabled = cursor === 0; $('next-line').disabled = cursor === dialogueIndices.length - 1;
  toolbar.restart.disabled = false;
  localStorage.setItem(storyPositionKey(), String(cursor));
  const scene = readScene(story, commandIndex, library.skeletons, library.images), model = scene.model;
  $('story-image').hidden = !scene.image;
  if (scene.image) $('story-image').src = asset(scene.image); else $('story-image').removeAttribute('src');
  $('story-placeholder').hidden = !!scene.image || !!model; $('story-motion').hidden = !model;
  const actors = (scene.actors || []).filter(actor => actor.file);
  $('story-actors').replaceChildren(...actors.map(actor => {
    const img = element('img', actor.talking ? 'talking' : ''); img.src = asset(actor.file); img.alt = '剧情角色立绘';
    const position = Number(actor.position); img.style.left = (position >= 1 && position <= 5 ? [20, 35, 50, 65, 80][position - 1] : 50) + '%';
    return img;
  })); $('story-actors').hidden = !actors.length;
  $('story-placeholder').hidden = !!scene.image || !!model || !!actors.length;
  if (scene.music !== storyMusicFile) {
    storyMusic.pause(); storyMusicFile = scene.music;
    if (scene.music) { storyMusic.src = asset(scene.music); storyMusic.play().catch(() => {}); } else storyMusic.removeAttribute('src');
  }
  if (scene.sound?.file && scene.sound.token !== storySoundToken) { storySoundToken = scene.sound.token; storySound.src = asset(scene.sound.file); storySound.play().catch(() => {}); }
  if (scene.transition && scene.transition.token !== storyTransitionToken) {
    storyTransitionToken = scene.transition.token; $('story-stage').classList.remove('story-fade'); void $('story-stage').offsetWidth; $('story-stage').classList.add('story-fade');
  }
  if (model) {
    if (director?.model?.file !== model.file) {
      director?.destroy(); director = new Player($('story-motion'));
      try { await director.load(model, { ...scene, assetRoot: currentSession.path + 'library/' }); }
      catch {
        if (generation !== storyGeneration) return;
        director?.destroy(); director = null; $('story-motion').hidden = true;
        $('story-image').hidden = !scene.fallbackImage; $('story-placeholder').hidden = !!scene.fallbackImage;
        if (scene.fallbackImage) $('story-image').src = asset(scene.fallbackImage);
        notify('动态 CG 未能加载。');
      }
    }
    if (generation !== storyGeneration) return;
    if (director) { director.placement = scene.placement; director.setAnimation(scene.animation, scene.loop, scene.token); }
  } else { director?.destroy(); director = null; }
  if (generation !== storyGeneration) return;
  const reference = line.args[2], voiceFile = story.voices?.[reference];
  if (voiceFile) { voice.src = asset(voiceFile); voice.play().catch(() => {}); } else voice.removeAttribute('src');
}

    container.addEventListener('keydown',event=>{if(event.target.matches('button,input,textarea,select,a'))return;if(event.key==='ArrowLeft'){event.preventDefault();$('previous-line').click();}if(event.key==='ArrowRight'||event.code==='Space'){event.preventDefault();$('next-line').click();}},{signal:events.signal});
    this.load=async data=>{story=data;dialogueIndices=story.commands.flatMap((row,index)=>row.command==='mess'?[index]:[]);const saved=Number(localStorage.getItem(options.positionKey));cursor=Number.isInteger(saved)&&saved>=0&&saved<dialogueIndices.length?saved:0;await showLine();};
    this.fail=error=>{$('dialogue-text').textContent=error.message;};
    this.destroy=()=>{toolbar.destroy();events.abort();storyGeneration++;director?.destroy();story=null;for(const audio of [voice,storyMusic,storySound]){audio.pause();audio.removeAttribute('src');}container.replaceChildren();};
  }
}
