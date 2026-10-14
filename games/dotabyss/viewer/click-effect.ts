function curve(spec,time){
  if(!spec||spec.minMaxState!==1)return spec?.scalar??1;
  const keys=spec.maxCurve?.m_Curve||[];if(!keys.length)return spec.scalar;
  const right=keys.findIndex(key=>key.time>=time);if(right===0)return keys[0].value*spec.scalar;if(right<0)return keys.at(-1).value*spec.scalar;
  const a=keys[right-1],b=keys[right],duration=b.time-a.time,t=(time-a.time)/duration,t2=t*t,t3=t2*t;
  return ((2*t3-3*t2+1)*a.value+(t3-2*t2+t)*a.outSlope*duration+(-2*t3+3*t2)*b.value+(t3-t2)*b.inSlope*duration)*spec.scalar;
}
function gradient(value,time,alpha=false){
  const count=value[alpha?'m_NumAlphaKeys':'m_NumColorKeys'],prefix=alpha?'atime':'ctime';
  const keys=Array.from({length:count},(_,i)=>({time:value[prefix+i]/65535,color:value['key'+i]})).sort((a,b)=>a.time-b.time);
  const at=keys.findIndex(key=>key.time>=time),a=at<=0?keys[at<0?keys.length-1:0]:keys[at-1],b=at<0?a:keys[at],t=a===b?0:(time-a.time)/(b.time-a.time||1);
  if(alpha)return a.color.a+(b.color.a-a.color.a)*t;
  return ['r','g','b'].map(key=>Math.round((a.color[key]+(b.color[key]-a.color[key])*t)*255));
}
export {curve as particleCurve,gradient as particleGradient};

export class DotabyssClickEffect{
  declare config: any;
  declare document: any;
  declare root: any;
  declare random: any;
  declare images: any;
  declare effects: any;
  declare tints: any;
  declare disposed: any;
  declare ready: any;
  declare failed: any;
  declare onPointer: any;

  constructor(config,{asset,root,document:doc=document,random=Math.random}: any={}){
    this.config=config;this.document=doc;this.root=root;this.random=random;this.images=new Map();this.effects=new Set<string>();this.tints=new Map();this.disposed=false;
    this.ready=Promise.all([...new Set<string>(config.layers.map(layer=>layer.file))].map(file=>new Promise<void>((resolve,reject)=>{const image=new Image();image.onload=()=>{this.images.set(file,image);resolve();};image.onerror=reject;image.src=asset(file);}))).catch(()=>{this.failed=true;});
    this.onPointer=event=>{if(event.button!==0||!root.closest('dialog[data-story-engine="dotabyss"][open]')||event.target.closest?.('[data-no-click-effect]'))return;this.burst(event.clientX,event.clientY,root);};
    root.addEventListener('pointerdown',this.onPointer,{capture:true});
  }
  tinted(file,color){const key=file+':'+color.join(',');if(this.tints.has(key))return this.tints.get(key);const source=this.images.get(file),canvas=this.document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0);ctx.globalCompositeOperation='source-atop';ctx.fillStyle='rgb('+color.join(',')+')';ctx.fillRect(0,0,canvas.width,canvas.height);if(this.tints.size>64)this.tints.clear();this.tints.set(key,canvas);return canvas;}
  async burst(x,y,parent){
    await this.ready;if(this.disposed||this.failed||!parent.isConnected||!this.root.closest('dialog[open]'))return;
    const canvas=this.document.createElement('canvas');canvas.className='dotabyss-click-effect';canvas.setAttribute('aria-hidden','true');canvas.width=400;canvas.height=400;
    const stage=parent.querySelector?.('.dotabyss-stage'),scale=.5*Math.min(1,(stage?.getBoundingClientRect().width||1536)/1920),size=400*scale;
    Object.assign(canvas.style,{position:'fixed',left:(x-size/2)+'px',top:(y-size/2)+'px',width:size+'px',height:size+'px',pointerEvents:'none',zIndex:'2147483647'});parent.append(canvas);
    const particles=this.config.layers.flatMap(layer=>Array.from({length:Math.min(50,layer.count)},()=>{
      let px=0,py=0;if(layer.count>1){const edge=Math.floor(this.random()*4),offset=this.random()-.5,s=layer.shape.m_Scale;let ax=edge===0?.5:edge===2?-.5:offset,ay=edge===1?.5:edge===3?-.5:offset;ax*=s.x;ay*=s.z;px=(ax-ay)/Math.SQRT2;py=(ax+ay)/Math.SQRT2;}
      return {layer,x:px,y:py,color:gradient(layer.color,Math.round(this.random()*7)/7)};
    }));
    const effect={canvas,frame:0},started=performance.now(),ctx=canvas.getContext('2d');this.effects.add(effect);
    while(this.effects.size>6){const first=this.effects.values().next().value;cancelAnimationFrame(first.frame);first.canvas.remove();this.effects.delete(first);}
    const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw=()=>{
      if(this.disposed||!canvas.isConnected)return this.remove(effect);
      const elapsed=(performance.now()-started)/1000;if(elapsed>(reduced ? .15 : this.config.duration))return this.remove(effect);
      ctx.clearRect(0,0,400,400);
      for(const p of particles){const l=p.layer,time=reduced ? .35 : (elapsed-l.delay)/l.lifetime;if(time<0||time>1)continue;
        const size=l.size*Math.abs(l.scale)*this.config.pixelsPerUnit*curve(l.sizeCurve,time),alpha=gradient(l.fade,time,true);if(size<=0||alpha<=0)continue;
        ctx.save();ctx.translate(200+p.x*this.config.pixelsPerUnit,200+p.y*this.config.pixelsPerUnit);ctx.rotate(l.rotation);ctx.globalAlpha=alpha;ctx.drawImage(this.tinted(l.file,p.color),-size/2,-size/2,size,size);ctx.restore();
      }
      effect.frame=requestAnimationFrame(draw);
    };draw();
  }
  remove(effect){cancelAnimationFrame(effect.frame);effect.canvas.remove();this.effects.delete(effect);}
  destroy(){this.disposed=true;this.root.removeEventListener('pointerdown',this.onPointer,{capture:true});for(const effect of this.effects)this.remove(effect);this.images.clear();this.tints.clear();}
}
