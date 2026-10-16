const el=(tag,cls='',text=''):any=>{const node=document.createElement(tag);node.className=cls;if(text)node.textContent=text;return node;};
const defaults=()=>({bgm:60,se:30,voice:30,speed:5,instant:false,autovoice:true});
export const cleanText=text=>String(text||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/?(?:color|size|b|i|ruby|rt|font)(?:=[^>]*)?>/gi,'').replace(/\\n/g,'\n');
export function sprite(node,key,theme,asset){
  const data=theme?.sprites?.[key];if(!data)return;
  const url='url("'+asset(data.file)+'")',border=data.border||[0,0,0,0];
  if(border.some(x=>x>0)){
    node.style.borderStyle='solid';node.style.borderColor='transparent';node.style.borderWidth='0';node.style.borderImageWidth=border.map(x=>`calc(${x} * var(--gc-unit))`).join(' ');
    node.style.borderImageSource=url;node.style.borderImageSlice=border.join(' ')+' fill';
  }else{node.style.backgroundImage=url;node.style.backgroundSize='100% 100%';}
}
export class StoryUi {
  host:any;panel:any;surface:any;speaker:any;text:any;textValue='';next:any;toolbar:any;modal:any;title:any;theme:any;separator:any;titleDone:any;titleWasHidden=false;mode='normal';hidden=false;buttons=new Map<string,any>();config=defaults();titleTimer:any;lastFocus:any;
  constructor(private stage,private asset,private actions){
    try{const saved=JSON.parse(localStorage.getItem('girlscreation-reader-settings-v1')||'{}');for(const key of ['bgm','se','voice'])if(Number.isFinite(saved[key]))this.config[key]=Math.max(0,Math.min(100,saved[key]));if(Number.isFinite(saved.speed))this.config.speed=Math.max(1,Math.min(10,saved.speed));for(const key of ['instant','autovoice'])if(typeof saved[key]==='boolean')this.config[key]=saved[key];}catch{}
    this.host=el('div','gc-native-ui');this.panel=el('div','gc-dialogue-panel');this.speaker=el('strong','gc-speaker');this.speaker.id='speaker';this.text=el('p','gc-dialogue-text');this.text.id='dialogue-text';this.text.setAttribute('aria-live','polite');this.toolbar=el('nav','gc-story-toolbar');this.toolbar.setAttribute('aria-label','剧情控制');
    this.surface=el('div','gc-dialogue-surface');this.surface.setAttribute('aria-hidden','true');
    for(const [key,label]of [['log','历史记录'],['auto','自动播放'],['skip','快进'],['hide','隐藏对白'],['settings','设置']]){
      const button=el('button','gc-native-round');button.type='button';button.setAttribute('aria-label',label);button.title=label;const icon=el('span','gc-native-icon');icon.setAttribute('aria-hidden','true');button.append(icon);this.buttons.set(key,button);this.toolbar.append(button);
      button.addEventListener('click',e=>{e.stopPropagation();if(key==='hide')this.hide(true);else if(key==='log')this.showLog();else if(key==='settings')this.showSettings();else this.actions[key]();});
    }
    this.next=el('button','gc-native-next');this.next.id='next-line';this.next.setAttribute('aria-label','下一句');this.next.onclick=e=>{e.stopPropagation();actions.next();};
    this.separator=el('div','gc-cg-name-line');this.separator.hidden=true;this.separator.setAttribute('aria-hidden','true');
    this.panel.append(this.surface,this.speaker,this.separator,this.text,this.toolbar,this.next);this.host.append(this.panel);stage.append(this.host);
  }
  async load(file){
    if(!file)return;const response=await fetch(this.asset(file));if(!response.ok)throw Error('原版播放器界面未保存，请点击“下载播放器界面”。');
    const theme=await response.json();if(theme.version!==1||!theme.sprites?.message)throw Error('播放器界面配置无效。');this.theme=theme;
    sprite(this.surface,'message',theme,this.asset);sprite(this.speaker,'name',theme,this.asset);sprite(this.next,'next',theme,this.asset);
    for(const [key,button]of this.buttons){sprite(button,'round',theme,this.asset);sprite(button.firstChild,key,theme,this.asset);}
    sprite(this.separator,'cgLine',theme,this.asset);
  }
  setMode(mode){
    if(this.mode===mode)return;this.mode=mode;this.panel.dataset.mode=mode;
    this.surface.removeAttribute('style');sprite(this.surface,mode==='video'?'cgMessage':'message',this.theme,this.asset);
    this.speaker.removeAttribute('style');if(mode!=='video')sprite(this.speaker,'name',this.theme,this.asset);
    this.separator.hidden=mode!=='video';
  }
  line(speaker,text){this.speaker.textContent=speaker;this.speaker.hidden=!speaker;this.textValue=text;this.text.textContent=text;this.fitText();}
  fitText(){
    this.text.style.removeProperty('font-size');const height=this.text.clientHeight;if(!height||!this.textValue)return;
    // Measure the complete line before typing so changing glyph count never
    // changes its size. System CJK fonts wrap differently from the game's font.
    const probe=this.text.cloneNode(false);probe.removeAttribute('id');probe.setAttribute('aria-hidden','true');Object.assign(probe.style,{visibility:'hidden',height:'auto',bottom:'auto',overflow:'visible'});probe.textContent=this.textValue;this.panel.append(probe);
    const base=parseFloat(getComputedStyle(probe).fontSize);let size=base;
    for(let i=0;i<24&&probe.scrollHeight>height+1;i++){size*=.96;probe.style.fontSize=size+'px';}
    if(size<base)this.text.style.fontSize=size+'px';probe.remove();
  }
  saveSettings(){try{localStorage.setItem('girlscreation-reader-settings-v1',JSON.stringify(this.config));}catch{}}
  active(key,value){const button=this.buttons.get(key);button.setAttribute('aria-pressed',String(value));sprite(button,value?'roundOn':'round',this.theme,this.asset);if(key==='auto')sprite(button.firstChild,value?'autoOn':'auto',this.theme,this.asset);}
  hide(value){this.hidden=value;this.host.hidden=value;if(!value)this.fitText();}
  chapter(title){
    if(!title)return Promise.resolve();this.title=el('div','gc-chapter-title');const band=el('div','gc-chapter-band'),text=el('span','gc-chapter-text',title),line=el('span','gc-chapter-line');sprite(band,'chapter',this.theme,this.asset);sprite(line,'titleLine',this.theme,this.asset);band.append(text,line);
    for(let i=0;i<9;i++){const spark=el('i','gc-chapter-spark');spark.style.setProperty('--spark',String(i));spark.setAttribute('aria-hidden','true');band.append(spark);}this.title.append(band);this.stage.append(this.title);this.titleWasHidden=this.host.hidden;this.host.hidden=true;
    this.titleTimer=setTimeout(()=>this.dismissTitle(),2900);return new Promise<void>(resolve=>this.titleDone=resolve);
  }
  dismissTitle(){if(!this.title)return false;clearTimeout(this.titleTimer);this.title.remove();this.title=null;this.host.hidden=this.hidden||this.titleWasHidden;this.titleDone?.();this.titleDone=null;return true;}
  openModal(label){
    this.actions.pause();this.closeModal();this.lastFocus=document.activeElement;const modal=el('section','gc-native-modal');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label',label);modal.tabIndex=-1;sprite(modal,'window',this.theme,this.asset);this.stage.append(modal);this.modal=modal;this.stage.classList.add('gc-modal-open');
    modal.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.closeModal();}else if(e.key==='Tab'){const nodes=[...modal.querySelectorAll('button:not(:disabled),input')];const at=nodes.indexOf(document.activeElement);if(e.shiftKey&&at<=0){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&at===nodes.length-1){e.preventDefault();nodes[0]?.focus();}}});modal.focus();return modal;
  }
  button(text,action,gold=false){const button=el('button','gc-native-button',text);button.type='button';sprite(button,gold?'buttonOn':'button',this.theme,this.asset);button.onclick=action;return button;}
  showLog(){
    const modal=this.openModal('历史记录'),list=el('div','gc-history-list');
    for(const [index,line]of this.actions.history().entries()){
      const row=el('div','gc-history-row'),jump=el('button','gc-history-jump');jump.type='button';jump.setAttribute('aria-label','回到第 '+(index+1)+' 句');sprite(row,'message',this.theme,this.asset);if(index===this.actions.cursor())row.classList.add('current');
      if(line.speaker)jump.append(el('strong','',line.speaker));jump.append(el('span','',line.text));jump.onclick=()=>{this.closeModal();this.actions.go(index);};row.append(jump);
      if(line.voice){const replay=this.button('▶',()=>this.actions.replay(line.voice));replay.classList.add('gc-history-voice');replay.setAttribute('aria-label','重听第 '+(index+1)+' 句');row.append(replay);}list.append(row);
    }
    const footer=el('div','gc-modal-footer');footer.append(this.button('关闭',()=>this.closeModal()));modal.append(list,footer);list.lastElementChild?.scrollIntoView({block:'nearest'});
  }
  showSettings(){
    const modal=this.openModal('剧情设置'),heading=el('h2','gc-settings-title','设置');sprite(heading,'title',this.theme,this.asset);const grid=el('div','gc-settings-grid'),sound=el('section','gc-settings-panel'),right=el('div','gc-settings-right'),text=el('section','gc-settings-panel'),voices=el('section','gc-settings-panel');
    for(const pane of [sound,text,voices])sprite(pane,'message',this.theme,this.asset);
    sound.append(el('h3','','声音'));text.append(el('h3','','文字'));voices.append(el('h3','','剧情语音'));
    const draft={...this.config},controls=new Map();
    const slider=(parent,key,label,min,max)=>{
      const row=el('div','gc-setting-row'),title=el('label','',label),input=el('input');input.type='range';input.min=min;input.max=max;input.value=draft[key];input.setAttribute('aria-label',label);const output=el('output','',String(draft[key])),track=el('div','gc-setting-track');
      const change=()=>{draft[key]=Number(input.value);output.value=input.value;};input.oninput=change;
      const less=this.button('−',()=>{input.value=String(Math.max(min,Number(input.value)-1));change();}),more=this.button('＋',()=>{input.value=String(Math.min(max,Number(input.value)+1));change();});less.setAttribute('aria-label',label+' 降低');more.setAttribute('aria-label',label+' 提高');track.append(less,input,more,output);row.append(title,track);parent.append(row);controls.set(key,{input,output});
    };
    for(const [key,label]of [['bgm','背景音乐'],['se','音效'],['voice','语音']])slider(sound,key,label,0,100);
    slider(text,'speed','显示速度',1,10);
    const check=(parent,key,label)=>{const row=el('label','gc-setting-check'),input=el('input');input.type='checkbox';input.checked=draft[key];input.onchange=()=>{draft[key]=input.checked;};row.append(input,el('span','',label));parent.append(row);controls.set(key,{input});};
    check(text,'instant','立即显示');text.append(el('p','gc-settings-sample','用画笔记录每一天的色彩。'));check(voices,'autovoice','自动播放当前台词语音');
    const reset=this.button('恢复默认',()=>{Object.assign(draft,defaults());for(const [key,c]of controls){if(c.input.type==='checkbox')c.input.checked=draft[key];else{c.input.value=draft[key];c.output.value=String(draft[key]);}}});right.append(text,voices,reset);grid.append(sound,right);
    const footer=el('div','gc-modal-footer');footer.append(this.button('关闭',()=>this.closeModal()),this.button('保存设置',()=>{this.config=draft;this.saveSettings();this.actions.settings(draft);this.closeModal();},true));modal.append(heading,grid,footer);
  }
  closeModal(){if(!this.modal)return;this.modal.remove();this.modal=null;this.stage.classList.remove('gc-modal-open');this.lastFocus?.isConnected&&this.lastFocus.focus();}
  destroy(){this.dismissTitle();this.modal?.remove();this.host.remove();}
}
