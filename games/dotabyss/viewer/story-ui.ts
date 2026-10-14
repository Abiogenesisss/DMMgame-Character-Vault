import {NativeUiView,paintText,layoutText} from './native-ui.ts';
const root='Box/Contents',soundRoot=root+'/ViewGroup/Sounds',textRoot=root+'/ViewGroup/Texts';
const defaults=()=>({speed:1,transparency:50,mute:false,levels:{bgm:50,se:50,voice:50,bgv:50},muted:{}});
const element=(tag,cls)=>{const el=document.createElement(tag);el.className=cls;return el;};
// Original CG material colors for caches exported before TMP underlay support.
const cgNameOutline={r:50/255,g:108/255,b:130/255,a:1};
const cgBodyOutline={r:.0116122449,g:.0193823613,b:.0466650277,a:222/255};
export class OriginalStoryUi{
  declare player: any;
  declare data: any;
  declare options: any;
  declare views: any;
  declare menuOpen: any;
  declare modal: any;
  declare config: any;
  declare menuHost: any;
  declare messageHost: any;
  declare menu: any;
  declare message: any;
  declare onKey: any;
  declare adult: any;
  declare prefix: any;
  declare lastText: any;
  declare savedOptions: any;
  declare optionView: any;
  declare optionInputs: any;

  constructor(player,data){
    this.player=player;this.data=data;this.options={asset:player.asset,fonts:data.fonts};this.views=[];this.menuOpen=false;this.modal=null;this.config=defaults();
    try{const saved=JSON.parse(localStorage.getItem('dotabyss-story-options-v1'));if(saved)this.config={...this.config,...saved,levels:{...this.config.levels,...saved.levels}};}catch{}
    this.menuHost=element('div','dotabyss-native-menu');this.messageHost=element('div','dotabyss-native-message');
    player.stage.append(this.messageHost,this.menuHost);this.menu=this.view(this.menuHost,'menu');this.message=this.view(this.messageHost,'message');
    const cgName=this.message.nodes.get('R18/TextName'),cgBody=this.message.nodes.get('R18/Sample_M_Text');
    if(cgName&&cgBody){
      // The name is vertically centered inside a taller container. Reserve
      // the gap below its text, excluding the container's empty bottom padding.
      const textHeight=Math.min(cgName.rect.height,cgName.row.text.size),textTop=(cgName.rect.height-textHeight)/2;
      const lift=cgName.rect.y+textTop+textHeight+12-cgBody.rect.y;
      if(lift>0)this.message.setRect('R18/TextName',{position:[cgName.row.position[0],cgName.row.position[1]+lift]});
    }
    player.window=this.message.get('');player.marker=this.message.get('Icon_NovelMarker');player.controls=this.menuHost;
    this.menu.bind('Auto/Button_AutoStart','自动播放',()=>this.setAuto(true));this.menu.bind('Auto/Button_AutoStop','停止自动播放',()=>this.setAuto(false));
    this.menu.bind('Skip/Button_Skip','跳过剧情',()=>this.openSkip());
    this.menu.bind('Menu/Button_MenuOpen','展开剧情菜单',()=>this.toggleMenu(true));this.menu.bind('Menu/Button_MenuClose','收起剧情菜单',()=>this.toggleMenu(false));
    this.menu.bind('SubMenu/Option/Button_Option','播放设置',()=>this.openOptions());this.menu.bind('SubMenu/Log/Button_Log','对白记录',()=>this.openLog());this.menu.bind('SubMenu/Invisible/Button_Invisible','隐藏界面',()=>player.toggleUi());
    this.setAuto(false);this.toggleMenu(false);this.setWindow(false);this.applyConfig();
    this.onKey=event=>{if(event.key==='Escape'&&this.modal){event.preventDefault();event.stopPropagation();this.closeModal(false);}else if(event.key==='Escape'&&this.menuOpen){event.preventDefault();event.stopPropagation();this.toggleMenu(false);}else if(event.key==='Tab'&&this.modal){const controls=[...this.modal.host.querySelectorAll('[tabindex="0"],input')].filter(el=>!el.closest('[hidden]')&&el.getAttribute('aria-disabled')!=='true');const first=controls[0],last=controls.at(-1);if(controls.length&&((event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last)||!this.modal.host.contains(document.activeElement))){event.preventDefault();(event.shiftKey?last:first).focus();}}};
    player.stage.addEventListener('keydown',this.onKey);
  }
  view(host,name,rows?: any){const view=new NativeUiView(host,rows||this.data.views[name],this.options);this.views.push(view);return view;}
  setAuto(value){this.player.auto=value;this.menu.show('Auto/Button_AutoStart',!value);this.menu.show('Auto/Button_AutoStop',value);for(const path of ['Auto/Button_AutoStart','Auto/Button_AutoStop'])this.menu.get(path).setAttribute('aria-pressed',String(value));}
  toggleMenu(value){this.menuOpen=value;this.menu.show('SubMenu',value);this.menu.show('Menu/Button_MenuOpen',!value);this.menu.show('Menu/Button_MenuClose',value);this.menu.get(value?'Menu/Button_MenuClose':'Menu/Button_MenuOpen').setAttribute('aria-expanded',String(value));}
  setWindow(adult){this.adult=adult;this.message.show('Normal',!adult);this.message.show('R18',adult);this.prefix=adult?'R18':'Normal';
    // Unity keeps the sample text inactive and creates NovelLetter objects at
    // runtime. We reuse its authored rectangle, so explicitly enable the body.
    this.message.show(this.prefix+'/Sample_M_Text');
    this.player.speaker=this.message.nodes.get(this.prefix+'/TextName').text;this.player.text=this.message.nodes.get(this.prefix+'/Sample_M_Text').text;
    this.applyConfig();if(this.lastText)this.writeText(this.lastText[0],this.lastText[1]);
  }
  writeText(speaker,text){
    this.lastText=[speaker,text];
    const nameStyle: any={outline:.15},bodyStyle: any={outline:.15,lineHeight:64,vertical:256};
    if(this.adult){
      const theme=this.player.theme||{},name=theme.name||{},body=theme.body||{};
      nameStyle.outline=name.outline??.15;nameStyle.outlineColor=name.outlineColor||this.message.nodes.get('R18/TextName').row.text.outlineColor||cgNameOutline;
      bodyStyle.outline=body.outline??.15;bodyStyle.outlineColor=body.outlineColor||cgBodyOutline;
      if(name.color)nameStyle.color=name.color;if(body.color)bodyStyle.color=body.color;
      if(Number.isFinite(name.fontSize)&&name.fontSize>0)nameStyle.size=name.fontSize;
      if(Number.isFinite(body.fontSize)&&body.fontSize>0)bodyStyle.size=body.fontSize;
      const size=bodyStyle.size||this.message.nodes.get('R18/Sample_M_Text').row.text.size;
      const lines=theme.linePositions?.find(pair=>pair._messageFontSize===size)?._lineYPos;
      if(lines?.length>1&&lines[0]>lines[1])bodyStyle.lineHeight=lines[0]-lines[1];
      bodyStyle.spacing=Number.isFinite(theme.letterSpacing)?theme.letterSpacing:-1;
    }
    this.message.setText(this.prefix+'/TextName',speaker,nameStyle);this.message.setText(this.prefix+'/Sample_M_Text',text,bodyStyle);
  }
  applyConfig(){
    for(const kind of ['voice','bgv','bgm','se'])this.player.audio.level(kind,this.config.mute||this.config.muted[kind]?0:Math.max(0,Math.min(100,this.config.levels[kind]))/100);
    this.player.textInterval=[75,40,20,0][this.config.speed]??40;
    const alpha=1-this.config.transparency/100;for(const prefix of ['Normal','R18'])this.message?.setOpacity(prefix+'/Box',alpha);
  }
  popup(name){this.player.hold?.stop();this.closeModal(false);const host=element('div','dotabyss-native-popup');host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label',name==='options'?'播放设置':name==='Popup_NovelLog'?'对白记录':'跳过剧情');this.player.stage.append(host);const view=this.view(host,name);this.modal={name,host,view,children:[]};view.bind('Box/Popup_Close','关闭窗口',()=>this.closeModal(false)).focus({preventScroll:true});return view;}
  closeModal(commit=false){if(!this.modal)return;this.player.audio.stop('log-voice');if(this.modal.name==='options'&&!commit&&this.savedOptions){this.config=this.savedOptions;this.applyConfig();}for(const view of this.modal.children)view.destroy();this.modal.view.destroy();const disposed=new Set([this.modal.view,...this.modal.children]);this.views=this.views.filter(v=>!disposed.has(v));this.modal.host.remove();this.modal=null;this.savedOptions=null;this.optionView=null;this.player.stage.focus({preventScroll:true});}
  openOptions(){
    const view=this.popup('options');this.savedOptions=structuredClone(this.config);this.optionView=view;this.optionInputs={};
    for(const index of [1,5])view.show(root+'/TabGroup/Tab'+index,false);
    [2,3,4].forEach((index,slot)=>{const path=root+'/TabGroup/Tab'+index;view.show(path);const row=view.nodes.get(path).row;Object.assign(row,{anchor:[0,1,0,1],position:[153,-60-slot*120]});});
    view.layout();
    for(const index of [2,3,4]){const path=root+'/TabGroup/Tab'+index;view.show(path+'/Button_Tab');view.show(path+'/Selected_Tab',false);const button=view.bind(path+'/Button_Tab',index===2?'战斗设置不可用于剧情播放器':index===3?'声音设置':'文字设置',()=>this.optionTab(index===4?'Texts':'Sounds'));if(index===2){button.setAttribute('aria-disabled','true');button.tabIndex=-1;}}
    for(const [name,kind]of [['BGM','bgm'],['SE','se'],['Voice','voice'],['BGV','bgv']]){
      const path=soundRoot+'/'+name,sliderPath=path+'/Builtin_Slider',slider=view.get(sliderPath),input=element('input','dotabyss-native-range');input.type='range';input.min='0';input.max='100';input.setAttribute('aria-label',name+'音量');slider.append(input);this.optionInputs[kind]=input;
      input.addEventListener('input',()=>{this.config.levels[kind]=Number(input.value);this.config.muted[kind]=false;this.applyConfig();this.refreshOptions();});
      view.bind(path+'/Button_Sound',name+'静音',()=>{this.config.muted[kind]=!this.config.muted[kind];this.applyConfig();this.refreshOptions();});
    }
    view.bind(soundRoot+'/AllMute/Builtin_Toggle','全部静音',()=>{this.config.mute=!this.config.mute;this.applyConfig();this.refreshOptions();});
    ['Speed0_Slow','Speed1_Normal','Speed2_High','Speed3_Skip'].forEach((name,index)=>view.bind(textRoot+'/Speed/Select/'+name,['慢速','普通速度','快速','立即显示'][index],()=>{this.config.speed=index;this.applyConfig();this.refreshOptions();}));
    for(const value of [0,50,100])view.bind(textRoot+'/Transparency/Select/Transparency_'+value,'窗口透明度 '+value+'%',()=>{this.config.transparency=value;this.applyConfig();this.refreshOptions();});
    view.bind(root+'/Button_OptionReset','恢复默认设置',()=>{this.config=defaults();this.applyConfig();this.refreshOptions();});
    view.bind(root+'/ButtonSet2/Button_Cancel','取消设置',()=>this.closeModal(false));view.bind(root+'/ButtonSet2/Button_Confirm','保存设置',()=>{localStorage.setItem('dotabyss-story-options-v1',JSON.stringify(this.config));this.closeModal(true);});
    this.optionTab('Sounds');this.refreshOptions();
  }
  optionTab(tab){const view=this.optionView;for(const name of ['Sounds','Texts','Battles','Window','Other'])view.show(root+'/ViewGroup/'+name,name===tab);for(const [index,name]of [[2,'Battles'],[3,'Sounds'],[4,'Texts']]){const path=root+'/TabGroup/Tab'+index;view.show(path+'/Selected_Tab',name===tab);view.show(path+'/Button_Tab',name!==tab);}}
  refreshOptions(){
    const view=this.optionView;if(!view)return;
    for(const [name,kind]of [['BGM','bgm'],['SE','se'],['Voice','voice'],['BGV','bgv']]){
      const path=soundRoot+'/'+name,value=this.config.levels[kind];this.optionInputs[kind].value=String(value);view.setText(path+'/Value',value+'%');
      const bar=path+'/Builtin_Slider/Bar',fill=bar+'/Volume';
      if(view.get(fill))Object.assign(view.get(fill).style,{left:'0',top:'0',width:value+'%',height:'100%'});
      const handle=view.nodes.get(bar+'/HandleArea/Handle');if(handle){handle.el.style.left=value+'%';handle.el.style.top='0';handle.el.style.height='100%';handle.el.style.transform='translateX(-50%)';}
      for(const [state,visible]of [['On',!this.config.muted[kind]&&!this.config.mute],['Off',!!this.config.muted[kind]||this.config.mute]])view.show(path+'/Button_Sound/RootUI/Base/Active/'+state,visible);
    }
    const toggle=soundRoot+'/AllMute/Builtin_Toggle/RootUI';view.show(toggle+'/L/On',this.config.mute);view.show(toggle+'/R/On',!this.config.mute);view.get(soundRoot+'/AllMute/Builtin_Toggle').setAttribute('aria-pressed',String(this.config.mute));
    ['Speed0_Slow','Speed1_Normal','Speed2_High','Speed3_Skip'].forEach((name,index)=>this.radio(view,textRoot+'/Speed/Select/'+name,index===this.config.speed));
    for(const value of [0,50,100])this.radio(view,textRoot+'/Transparency/Select/Transparency_'+value,value===this.config.transparency);
    view.setOpacity(textRoot+'/Transparency/Sample/WindowSample/Box',1-this.config.transparency/100);
  }
  radio(view,path,on){view.show(path+'/RootUI/Parts/On',on);view.show(path+'/RootUI/Parts/Off',!on);view.get(path)?.setAttribute('aria-pressed',String(on));}
  openSkip(){
    const view=this.popup('Popup_NovelSkip');view.setText('Box/Contents/Box/Scenario/Text',this.player.story.title||'');
    view.bind('Box/Contents/Popup_ButtonSet2/Button_Cancel','继续播放',()=>this.closeModal(true));
    view.bind('Box/Contents/Popup_ButtonSet2/Button_Confirm','跳过本章剧情',async()=>{this.closeModal(true);this.setAuto(false);await this.player.engine.seek(Math.max(0,this.player.story.program.dialogue-1));this.player.reveal();await this.player.engine.next();});
  }
  openLog(){
    const player=this.player;if(!player.engine)return;const view=this.popup('Popup_NovelLog');
    const path='Box/Contents/Scroll View/Viewport/Content',list=view.get(path);list.replaceChildren();list.classList.add('dotabyss-native-log-list');Object.assign(list.style,{top:'0',left:'0',height:'100%',width:'100%',overflowY:'auto',overflowX:'hidden'});
    view.show('Box/Contents/Scroll View/Scrollbar',false);
    const font=Object.values<any>(this.data.fonts)[0]||{size:36,glyphs:{}},rowWidth=view.nodes.get('Box/Contents/Scroll View/Viewport').rect.width-24;
    const rect=(view,path,x,y,width,height)=>Object.assign(view.nodes.get(path).row,{anchor:[0,1,0,1],pivot:[0,1],position:[x,-y],size:[width,height]});
    for(const action of player.story.program.commands.filter(a=>a.dialogue!==undefined&&a.dialogue<=player.engine.line)){
      const text=String(action.text).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'').replace(/\\n/g,'\n'),user=/<user>|<player>/.test(action.speaker||''),type=!action.speaker?'NarrationBalloon':user?'UserBalloon':'CharaBalloon';
      const host=element('div','dotabyss-log-line'),layout=layoutText(text,font,{size:36,width:1352,lineHeight:58}),textWidth=Math.max(160,Math.ceil(layout.width)),textHeight=Math.ceil(layout.height),boxHeight=textHeight+40;
      const height=Math.max(type==='CharaBalloon'?204:76,boxHeight+(type==='CharaBalloon'?49:0));Object.assign(host.style,{width:`calc(${rowWidth} * var(--native-unit))`,height:`calc(${height} * var(--native-unit))`,position:'relative'});list.append(host);
      const rows=this.data.views[type].map(r=>({...r,anchor:[...r.anchor],position:[...r.position],size:[...r.size]}));rows[0]={...rows[0],anchor:[0,0,1,1],position:[0,0],size:[0,0],pivot:[.5,.5]};
      const bubble=new NativeUiView(host,rows,{...this.options,width:rowWidth,height});this.views.push(bubble);this.modal.children.push(bubble);
      // Measure and paint with the same content width. The source bubble has
      // additional padding and a voice-button area outside that text rectangle.
      if(type==='NarrationBalloon'){rect(bubble,'Box',(rowWidth-1392)/2,0,1392,boxHeight);rect(bubble,'Box/Text',20,20,1352,textHeight);bubble.layout();bubble.setText('Box/Text',text,{lineHeight:58});}
      else if(type==='UserBalloon'){
        rect(bubble,'UserBalloon',rowWidth-textWidth-98,0,textWidth+98,boxHeight);rect(bubble,'UserBalloon/Box',0,0,textWidth+40,boxHeight);rect(bubble,'UserBalloon/Box/Text',20,20,textWidth,textHeight);
        rect(bubble,'UserBalloon/Tail',textWidth+34,(boxHeight-24)/2,24,24);bubble.layout();bubble.setText('UserBalloon/Box/Text',text,{lineHeight:58});
      }else{
        const actor=player.story.actors?.[action.actor],icon=actor?.icon||player.story.icons?.[action.speaker];if(icon)bubble.setImage('Thumbnail_Chara_SS/Waiting/RootUI/Fade/Base/SpriteCharaIcon',icon);
        const path='Serif/MainBalloon/Button',mainWidth=textWidth+116;rect(bubble,'Serif',192.5,.5,rowWidth-192.5,height-.5);rect(bubble,'Serif/Name',.5,0,rowWidth-193,42);rect(bubble,'Serif/MainBalloon',.5,48,mainWidth,boxHeight);
        rect(bubble,path,4,0,mainWidth-4,boxHeight);rect(bubble,path+'/Box',20,0,textWidth+60,boxHeight);rect(bubble,path+'/Box/Text',20,20,textWidth,textHeight);
        rect(bubble,path+'/Sound',mainWidth-40,(boxHeight-82)/2,36,82);bubble.layout();bubble.setText('Serif/Name/TextName',action.speaker);bubble.setText(path+'/Box/Text',text,{lineHeight:58});
        const voice=action.cue&&player.story.audio[action.cue]?.file;bubble.show(path+'/Sound',!!voice);if(voice)bubble.bind(path+'/Sound/Button_Sound','重听配音',()=>player.audio.play('log-voice',voice,{kind:'voice'}));
      }
      host.tabIndex=0;host.setAttribute('role','button');host.setAttribute('aria-label','回到这句对白');const replay=()=>{this.closeModal(true);player.engine.seek(action.dialogue);};host.addEventListener('click',replay);host.addEventListener('keydown',e=>{if(e.key==='Enter'){e.stopPropagation();replay();}});
    }
    list.scrollTop=list.scrollHeight;
  }
  destroy(){this.closeModal(true);this.player.stage.removeEventListener('keydown',this.onKey);for(const view of this.views)view.destroy();this.views=[];this.menuHost.remove();this.messageHost.remove();}
}
