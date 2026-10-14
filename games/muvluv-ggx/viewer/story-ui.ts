import { NativeUiView, layoutText } from './native-ui.ts';
import { plain } from './story-format.ts';
import { solveNativeLayout } from './native-layout.ts';
const msg='ScenarioText Variant',box=msg+'/TextView/Layout',menu='RightTop/Menu',buttons=menu+'/MenuButtons/Container/';
const sound='Body/Frame/SoundUI/ScrollView/Viewport/Content/',scenario='Body/Frame/ScenarioUI/ScrollView/Viewport/Content/';
const defaults=()=>({speed:1,opacity:70,mute:false,levels:{bgm:50,se:50,voice:100,bgv:70}});
const element=cls=>{const el=document.createElement('div');el.className=cls;return el;};
export class MuvStoryUi{
  declare p: any;
  declare data: any;
  declare options: any;
  declare config: any;
  declare views: any;
  declare modal: any;
  declare menuOpen: any;
  declare host: any;
  declare main: any;
  declare key: any;
  declare logOpen: any;
  declare hidden: any;
  declare option: any;
  declare ranges: any;
  declare logViews: any;

  constructor(player,data){
    this.p=player;this.data=data;this.options={asset:player.asset,fonts:data.fonts,width:1920,height:1080};this.config=defaults();this.views=[];this.modal=null;this.menuOpen=false;
    try{const saved=JSON.parse(localStorage.getItem('muvluv-story-options-v1'));if(saved)this.config={...this.config,...saved,levels:{...this.config.levels,...saved.levels}};}catch{}
    this.host=element('muv-native-ui');player.stage.append(this.host);this.main=this.view(this.host,'menu');
    for(const path of ['FrameSkipButton','FadeParent','Choce','History'])this.main.show(path,false);
    this.main.bind(menu+'/Container/MenuButton','展开或收起菜单',()=>this.toggleMenu());
    this.main.bind(buttons+'ScreenButton','隐藏窗口',()=>this.hide());this.main.bind(buttons+'SettingsButton','播放设置',()=>this.openOptions());
    this.main.bind(buttons+'AutoButton','自动播放',()=>this.setAuto(!player.auto));this.main.bind(buttons+'LogButton','会话记录',()=>this.openLog());
    this.main.bind(buttons+'SkipButton','快速播放',()=>player.setSkip(!player.skip));this.main.bind(buttons+'Scale Button Variant All Skip','跳过本章',()=>this.confirmSkip());
    this.main.bind('History/Button/Button','关闭记录',()=>this.closeLog());
    this.toggleMenu(false);this.setAuto(false);this.line({});this.apply();
    this.key=e=>{if(e.key==='Escape'&&(this.modal||this.logOpen||this.hidden)){e.preventDefault();e.stopPropagation();if(this.modal)this.close(false);else if(this.logOpen)this.closeLog();else this.hide(false);}else if(e.key==='Tab'&&this.modal){const nodes=[...this.modal.host.querySelectorAll('[tabindex="0"],input')].filter(n=>!n.closest('[hidden]')&&n.getAttribute('aria-disabled')!=='true');const first=nodes[0],last=nodes.at(-1);if(first&&((e.shiftKey&&document.activeElement===first)||(!e.shiftKey&&document.activeElement===last))){e.preventDefault();(e.shiftKey?last:first).focus();}}};
    player.stage.addEventListener('keydown',this.key);
  }
  view(host,key,rows=this.data.views[key],size: any={}){const view=new NativeUiView(host,rows,{...this.options,...size});for(const {el,row} of view.nodes.values())if(row.opacity!==undefined)el.style.opacity=row.opacity;solveNativeLayout(view);this.views.push(view);return view;}
  bind(view,path,label,run){return view.get(path)?view.bind(path,label,run):null;}
  apply(){for(const kind of ['bgm','se','voice','bgv'])this.p.audio.level(kind,this.config.mute?0:Math.max(0,Math.min(100,Number(this.config.levels[kind])||0))/100);this.main.setOpacity(msg+'/TextView/TextViewBgImage',Math.max(0,Math.min(100,this.config.opacity))/100);}
  toggleMenu(value=!this.menuOpen){this.menuOpen=value;this.main.show(menu+'/MenuButtons',value);}
  setAuto(value){this.p.auto=value;this.p.setSkip(false);this.main.get(buttons+'AutoButton')?.setAttribute('aria-pressed',String(value));if(value)this.p.queueAuto();}
  hide(value=!this.hidden){this.hidden=value;this.host.style.visibility=value?'hidden':'';this.p.hold?.stop();}
  line(phrase){this.main.show(msg,!phrase.NeedsHideText);this.main.setText(box+'/NamePlate/NameText',plain(phrase.SpeakerName));this.main.setText(box+'/NamePlate/AffiliationText',plain(phrase.TeamName));this.main.show(box+'/NamePlate',!!(phrase.SpeakerName||phrase.TeamName));this.text('');}
  text(text,done=false){this.main.setText(box+'/Text/TextViewText',text);this.main.show(box+'/Text/TextViewText/TailContainer/Tail',done);}
  popup(key){this.close(true);this.closeLog();this.p.hold?.stop();this.p.audio.pauseAll();this.p.skip=false;this.p.clearAuto();const host=element('muv-native-popup');this.p.stage.append(host);const view=this.view(host,key);this.modal={host,view,children:[],snapshot:structuredClone(this.config),focus:document.activeElement};
    const close=key==='options'?'SystemSettingWindowFrame Variant':'TextModalFrame Variant';
    this.bind(view,close+'/Frame/UpperRight/DialogCloseButtonContainer/DialogCloseButton','关闭窗口',()=>this.close(false));
    this.bind(view,close+'/BackGround','关闭窗口',()=>this.close(false));
    for(const name of ['Custom First Button','Custom Second Button'])view.show(close+'/Frame/UnderCenter/Buttons/'+name,false);
    view.get(close+'/Frame/UpperRight/DialogCloseButtonContainer/DialogCloseButton')?.focus();return view;
  }
  close(save=true){if(!this.modal)return;const modal=this.modal;this.modal=null;if(!save){this.config=modal.snapshot;this.apply();}for(const child of [modal.view,...modal.children]){child.destroy();this.views=this.views.filter(v=>v!==child);}modal.host.remove();modal.focus?.focus?.({preventScroll:true});this.p.audio.resumeAll();this.p.queueAuto();}
  confirmSkip(){const view=this.popup('confirm'),root='TextModalFrame Variant/Frame';view.setText(root+'/UpperCenter/TitleText','スキップ');view.setText('Body','このエピソードをスキップしますか？');view.setText(root+'/UnderCenter/Buttons/Ok Button Variant/Text (TMP)','スキップ');view.show(root+'/UnderCenter/Buttons/Cancel Button Variant',true);
    view.bind(root+'/UnderCenter/Buttons/Cancel Button Variant','继续剧情',()=>this.close(true));view.bind(root+'/UnderCenter/Buttons/Ok Button Variant','确认跳过本章',async()=>{this.close(true);this.setAuto(false);await this.p.engine.seek(Math.max(0,this.p.story.program.dialogue-1));this.p.reveal();await this.p.engine.next();});solveNativeLayout(view);}
  openOptions(){const view=this.popup('options'),frame='SystemSettingWindowFrame Variant/Frame';this.option=view;view.setText(frame+'/UpperCenter/TitleText','設定');
    for(const tab of ['System','Notification'])this.bind(view,'Body/SideButtons/SIde '+tab+' Button Variant','此设置仅用于原游戏',()=>{})?.setAttribute('aria-disabled','true');
    for(const tab of ['Sound','Scenario'])view.bind('Body/SideButtons/SIde '+tab+' Button Variant',tab==='Sound'?'声音设置':'剧情设置',()=>this.tab(tab));
    this.ranges={};for(const [cell,kind]of [['BgmCell','bgm'],['SeCell','se'],['VoiceCell','voice'],['BGVoiceCell','bgv']]){const root=sound+cell+'/Slider Variant/Slider',el=view.get(root),input=document.createElement('input');input.type='range';input.min='0';input.max='100';input.className='muv-native-range';input.setAttribute('aria-label',kind+' 音量');input.value=this.config.levels[kind];input.addEventListener('input',()=>{this.config.levels[kind]=Number(input.value);this.apply();this.refreshOptions();});el.append(input);this.ranges[kind]={input,root};view.bind(sound+cell+'/MuteButton','静音 '+kind,()=>{this.config.levels[kind]=this.config.levels[kind]?0:50;this.apply();this.refreshOptions();});}
    view.bind(sound+'AllMuteCell/AllMuteBackGround/Background','全静音',()=>{this.config.mute=!this.config.mute;this.apply();this.refreshOptions();});
    ['Slow','Normal','Fast'].forEach((name,i)=>view.bind(scenario+'TextSpeed/Buttons/'+name,'文字速度 '+name,()=>{this.config.speed=i;this.refreshOptions();}));
    [['PaleColor',35],['Normal',70],['DeepColor',100]].forEach(([name,value])=>view.bind(scenario+'BackgroundAlpha/Buttons/'+name,'窗口浓度 '+value+'%',()=>{this.config.opacity=value;this.apply();this.refreshOptions();}));
    for(const name of ['SkipIfDownloadVoice','VoiceDownload','SkipIfPlayRated'])view.show(scenario+name,false);
    view.bind(sound+'InitializationCell/Initialization Button Variant','恢复默认设置',()=>{this.config=defaults();this.apply();this.refreshOptions();});
    view.show(frame+'/UnderCenter/Buttons/Cancel Button Variant',true);view.bind(frame+'/UnderCenter/Buttons/Cancel Button Variant','取消设置',()=>this.close(false));view.bind(frame+'/UnderCenter/Buttons/Ok Button Variant','保存设置',()=>{localStorage.setItem('muvluv-story-options-v1',JSON.stringify(this.config));this.close(true);});
    for(const tab of ['Sound','Scenario']){const viewport=view.get('Body/Frame/'+tab+'UI/ScrollView/Viewport');if(viewport)Object.assign(viewport.style,{overflowY:'auto',pointerEvents:'auto'});}
    this.tab('Sound');solveNativeLayout(view);this.refreshOptions();
  }
  tab(tab){for(const name of ['System','Sound','Scenario','Notification']){this.option.show('Body/Frame/'+name+'UI',name===tab);this.option.show('Body/SideButtons/SIde '+name+' Button Variant/'+name+'HoverObject',name===tab);}}
  refreshOptions(){if(!this.option||!this.modal)return;for(const [kind,{input,root}]of Object.entries<any>(this.ranges)){const value=this.config.levels[kind];input.value=value;const fill=this.option.get(root+'/Fill Area/Fill'),handle=this.option.get(root+'/Handle Slide Area/Handle');if(fill)fill.style.width=value+'%';if(handle)handle.style.left=value+'%';this.option.setText(root+'/Handle Slide Area/Handle/ValueView/BackGround/ValueText',String(value));}
    const radio=(base,selected)=>{for(const [key,value] of this.option.nodes)if(key.startsWith(base+'/')&&/HoverImage$/.test(key)){const name=key.slice(base.length+1).split('/')[0];value.el.hidden=name!==selected;}};
    radio(scenario+'TextSpeed/Buttons',['Slow','Normal','Fast'][this.config.speed]||'Normal');radio(scenario+'BackgroundAlpha/Buttons',this.config.opacity<50?'PaleColor':this.config.opacity<85?'Normal':'DeepColor');
    this.option.setOpacity(scenario+'ScenarioBackground/ScenarioText Variant/TextView/TextViewBgImage',this.config.opacity/100);
  }
  closeLog(){if(!this.logOpen)return;this.logOpen=false;this.main.show('History',false);for(const view of this.logViews||[]){view.destroy();this.views=this.views.filter(v=>v!==view);}this.logViews=[];this.p.audio.stop('log');this.p.audio.resumeAll();this.p.queueAuto();}
  openLog(){if(!this.p.engine)return;this.closeLog();this.logOpen=true;this.p.clearAuto();this.p.audio.pauseAll();this.p.hold?.stop();this.main.show('History',true);const path='History/HistoryScrollView Variant',list=this.main.get(path+'/Content');list.replaceChildren();Object.assign(list.style,{height:'100%',overflowY:'auto',overflowX:'hidden',pointerEvents:'auto'});this.logViews=[];
    const font=Object.values<any>(this.data.fonts)[0],rect=(view,path,x,y,w,h)=>{const item=view.nodes.get(path);if(item)Object.assign(item.row,{anchor:[0,1,0,1],pivot:[0,1],position:[x,-y],size:[w,h]});};
    for(const action of this.p.story.program.commands.filter(a=>a.dialogue!==undefined&&a.dialogue<=this.p.engine.line)){const phrase=action.data.Phrase,text=plain(phrase.Text),height=layoutText(text,font,{size:30,width:1200,lineHeight:48}).height+150,host=element('muv-log-row');host.style.height=`calc(${height} * var(--native-unit))`;list.append(host);
      const rows=this.data.views.logRow.filter(row=>!row.path.startsWith('Cell/CharacterIconContainer/Scaler/'));
      const view=this.view(host,'logRow',rows,{width:1460,height});this.logViews.push(view);rect(view,'',0,0,1460,height);rect(view,'Cell',0,0,1460,height);rect(view,'Cell/Name',150,0,1260,50);rect(view,'Cell/Frame',150,60,1260,height-70);rect(view,'Cell/Frame/Text',24,12,1200,height-150);rect(view,'Cell/Frame/ButtonContainer',24,height-148,1200,60);view.layout();view.setText('Cell/Name',plain(phrase.SpeakerName));view.setText('Cell/Frame/Text',text,{lineHeight:48});
      const icon=action.data.Character1?.AssetId&&this.p.story.icons?.[action.data.Character1.AssetId];view.show('Cell/CharacterIconContainer/Scaler',false);view.show('Cell/CharacterIconContainer',!!icon);if(icon){const image=document.createElement('img');image.src=this.p.asset(icon);image.alt='';Object.assign(image.style,{width:'100%',height:'100%',borderRadius:'50%'});view.get('Cell/CharacterIconContainer').append(image);}
      const voice=phrase.VoiceAssetIds?.[0],file=voice&&this.p.story.resources['ASA/'+voice+'.ogg'];view.show('Cell/Frame/ButtonContainer/Buttons/SoundButton',!!file);if(file)view.bind('Cell/Frame/ButtonContainer/Buttons/SoundButton','重听配音',()=>this.p.audio.play('log',file,{kind:'voice'}));view.bind('Cell/Frame/ButtonContainer/Buttons/JumpButton','回到这句',()=>{this.closeLog();this.p.engine.seek(action.dialogue);});
    }
    list.scrollTop=list.scrollHeight;
  }
  destroy(){this.close(true);this.closeLog();this.p.stage.removeEventListener('keydown',this.key);for(const view of this.views)view.destroy();this.views=[];this.host.remove();}
}
