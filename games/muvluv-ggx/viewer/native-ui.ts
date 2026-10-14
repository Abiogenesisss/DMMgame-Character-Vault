const cache=new Map();
const rgba=color=>`rgba(${Math.round(color.r*255)},${Math.round(color.g*255)},${Math.round(color.b*255)},${color.a??1})`;
const px=value=>`calc(${value} * var(--native-unit))`;
// Unity allows siblings with the same name (the two SKIP decorations are both
// "Deco"). Paths are lookup aliases; each occurrence still needs its own node.
function keyedRows(rows){
  const counts=new Map(),parents=new Map();
  return rows.map(row=>{const count=counts.get(row.path)||0,key=row.path+(count?'#'+count:'');counts.set(row.path,count+1);
    const parent=row.path?parents.get(row.path.includes('/')?row.path.slice(0,row.path.lastIndexOf('/')):'')??null:null;parents.set(row.path,key);return {...row,key,parent};});
}

export async function loadNativeUi(file,asset){
  const key=asset(file);
  if(!cache.has(key))cache.set(key,(async()=>{
    const response=await fetch(key);if(!response.ok)throw new Error('原版窗口素材读取失败，请重新整理资源库。');
    const data=await response.json();if(data.version!==1||!data.views?.menu||!data.views?.options)throw new Error('原版窗口素材版本无效。');
    const fonts={};
    await Promise.all(Object.entries<any>(data.fonts||{}).map(async([name,file])=>{
      const response=await fetch(asset(file));if(!response.ok)throw new Error('原版字体图集读取失败。');
      const font=await response.json();
      const load=file=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('原版字形素材读取失败。'));image.src=asset(file);});
      if(font.pages){
        font.atlasImages=await Promise.all(font.pages.map(async page=>({...page,fillImage:await load(page.fill),outlineImage:await load(page.outline)})));
        font.fillImage=font.atlasImages[0].fillImage;font.outlineImage=font.atlasImages[0].outlineImage;
      }else [font.fillImage,font.outlineImage]=await Promise.all([load(font.fill),load(font.outline)]);
      fonts[name]=font;
    }));
    return {...data,fonts};
  })().catch(error=>{cache.delete(key);throw error;}));
  return cache.get(key);
}

export function layoutText(text,font,{size=36,width=1400,lineHeight=size*1.5,spacing=0}: any={}){
  const scale=size/font.size,lines=[{glyphs:[],width:0}];
  for(const char of String(text).replace(/\r/g,'')){
    if(char==='\n'){lines.push({glyphs:[],width:0});continue;}
    const glyph=font.glyphs[char.codePointAt(0)],advance=(glyph?.[6]??font.size)*scale+spacing;
    let line=lines.at(-1);if(line.glyphs.length&&line.width+advance>width){line={glyphs:[],width:0};lines.push(line);}
    line.glyphs.push({char,glyph,x:line.width});line.width+=advance;
  }
  return {lines,scale,lineHeight,width:Math.min(width,Math.max(0,...lines.map(line=>line.width))),height:Math.max(size,(lines.length-1)*lineHeight+size)};
}

export function paintText(element,text,font,style: any={},width=1400,height=100){
  element.textContent=text;element.classList.remove('muv-bitmap-text');const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');canvas.className='muv-glyphs';
  if(!font?.fillImage||!width||!height)return;
  canvas.width=Math.max(1,Math.ceil(width));canvas.height=Math.max(1,Math.ceil(height));
  const context=canvas.getContext('2d');if(!context)return;
  const size=style.size||36,layout=layoutText(text,font,{size,width,lineHeight:style.lineHeight||size*1.55,spacing:style.spacing||0});
  const top=style.vertical===512?(height-layout.height)/2:style.vertical===1024?height-layout.height:0;
  function draw(atlas,tint,outline=false){
    const ink=document.createElement('canvas');ink.width=canvas.width;ink.height=canvas.height;const ctx=ink.getContext('2d');
    layout.lines.forEach((line,lineIndex)=>{
      const left=style.horizontal===2?(width-line.width)/2:style.horizontal===4?width-line.width:0;
      for(const {char,glyph,x}of line.glyphs){
        if(!glyph){
          // The original atlas covers Japanese dialogue, but not every Chinese
          // character in local chapter labels or a user-supplied player name.
          ctx.font=`${size}px "Yu Gothic",Meiryo,sans-serif`;ctx.textBaseline='alphabetic';
          const baseline=top+lineIndex*layout.lineHeight+font.ascent*layout.scale;
          if(outline){ctx.lineWidth=size*.12;ctx.lineJoin='round';ctx.strokeText(char,left+x,baseline);}else ctx.fillText(char,left+x,baseline);
          continue;
        }
        if(!glyph[2]||!glyph[3])continue;
        const [gx,gy,gw,gh,bx,by]=glyph,p=font.padding,scale=layout.scale;
        const page=font.atlasImages?.[glyph[7]||0];
        ctx.drawImage(page?(outline?page.outlineImage:page.fillImage):atlas,gx-p,(page?.height??font.height)-gy-gh-p,gw+2*p,gh+2*p,left+x+(bx-p)*scale,top+lineIndex*layout.lineHeight+(font.ascent-by-p)*scale,(gw+2*p)*scale,(gh+2*p)*scale);
      }
    });
    ctx.globalCompositeOperation='source-in';ctx.fillStyle=tint;ctx.fillRect(0,0,ink.width,ink.height);context.drawImage(ink,0,0);
  }
  if(style.outline)draw(font.outlineImage,rgba(style.outlineColor||{r:.09,g:.12,b:.19,a:1}),true);
  draw(font.fillImage,rgba(style.color||{r:1,g:1,b:1,a:1}));element.classList.add('muv-bitmap-text');element.append(canvas);
  return layout;
}

export function nativeRects(rows,width=1920,height=1080){
  const rects=new Map();
  for(const row of keyedRows(rows)){
    const parent=row.parent===null?null:rects.get(row.parent);
    const pw=parent?.width??width,ph=parent?.height??height,[ax,ay,bx,by]=row.anchor,[pivotX,pivotY]=row.pivot;
    const w=Math.max(0,pw*(bx-ax)+row.size[0]),h=Math.max(0,ph*(by-ay)+row.size[1]);
    rects.set(row.key,{x:pw*(ax+(bx-ax)*pivotX)+row.position[0]-w*pivotX,
      y:ph-(ph*(ay+(by-ay)*pivotY)+row.position[1])-h*(1-pivotY),width:w,height:h});
  }
  return rects;
}

export class NativeUiView{
  declare host: any;
  declare asset: any;
  declare fonts: any;
  declare width: any;
  declare height: any;
  declare nodes: any;
  declare rows: any;

  constructor(host,rows,{asset,fonts={},width=1920,height=1080}: any={}){
    this.host=host;this.asset=asset;this.fonts=fonts;this.width=width;this.height=height;this.nodes=new Map();
    this.rows=keyedRows(rows).map(row=>({...row,anchor:[...row.anchor],position:[...row.position],size:[...row.size]}));
    for(const row of this.rows){
      const el=document.createElement('div');el.className='muv-native-node';el.dataset.nativePath=row.path;el.hidden=!row.active;
      if(row.image){const graphic=document.createElement('div');graphic.className='muv-native-image';const url='url("'+asset(row.image.file)+'")';
        if(row.image.sliced&&row.image.border.some(v=>v>0)){graphic.style.borderImageSource=url;graphic.style.borderImageSlice=row.image.border.join(' ')+' fill';graphic.style.borderWidth=row.image.border.map(px).join(' ');graphic.style.borderStyle='solid';graphic.style.borderColor='transparent';}
        else{graphic.style.backgroundImage=url;graphic.style.backgroundSize=row.image.preserveAspect?'contain':'100% 100%';}
        graphic.style.opacity=String(row.image.opacity??1);el.append(graphic);
      }
      let text;if(row.text){text=document.createElement('span');text.className='muv-native-text';el.append(text);}
      if(row.clip)el.style.overflow='hidden';
      const parent=row.parent===null?null:this.nodes.get(row.parent)?.el;(parent||host).append(el);
      this.nodes.set(row.key,{el,text,row});
    }
    this.layout();
  }
  layout(){
    const rects=nativeRects(this.rows,this.width,this.height);
    for(const [path,value]of this.nodes){const {el,row}=value,rect=rects.get(path);value.rect=rect;
      Object.assign(el.style,{left:px(rect.x),top:px(rect.y),width:px(rect.width),height:px(rect.height),transformOrigin:`${row.pivot[0]*100}% ${(1-row.pivot[1])*100}%`,transform:`rotate(${row.rotation||0}deg) scale(${row.scale[0]},${row.scale[1]})`});
      if(value.text)this.setText(path,row.text.value);
    }
  }
  get(path){return this.nodes.get(path)?.el;}
  show(path,visible=true){const el=this.get(path);if(el)el.hidden=!visible;}
  setRect(path,changes){const value=this.nodes.get(path);if(value){Object.assign(value.row,changes);this.layout();}}
  setText(path,text,style?: any){const value=this.nodes.get(path);if(!value?.text)return;value.row.text={...value.row.text,...style,value:String(text)};
    const font=this.fonts[value.row.text.font]||Object.values<any>(this.fonts)[0];paintText(value.text,String(text),font,value.row.text,value.rect.width,value.rect.height);
  }
  setImage(path,file){const el=this.get(path)?.querySelector(':scope > .muv-native-image');if(el){el.style.borderImageSource='none';el.style.borderWidth='0';el.style.backgroundImage='url("'+this.asset(file)+'")';el.style.backgroundSize='100% 100%';}}
  setOpacity(path,value){const image=this.get(path)?.querySelector(':scope > .muv-native-image');if(image)image.style.opacity=String(value);}
  bind(path,label,action){const el=this.get(path);if(!el)throw new Error('原版窗口缺少控件：'+path);
    el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',label);el.classList.add('muv-native-button');
    el.addEventListener('click',event=>{event.stopPropagation();if(el.getAttribute('aria-disabled')!=='true')action(event);});
    el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.code==='Space'){event.preventDefault();event.stopPropagation();el.click();}});return el;
  }
  destroy(){this.host.replaceChildren();this.nodes.clear();}
}
