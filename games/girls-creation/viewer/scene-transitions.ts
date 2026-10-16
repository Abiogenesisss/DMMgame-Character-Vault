// The game's transition textures are luminance masks. Keep them in the local
// library and animate their threshold instead of substituting a generic wipe.
export class SceneTransitions {
  canvas:HTMLCanvasElement;frame:any;finish:any;generation=0;images=new Map<string,Promise<HTMLImageElement>>();
  constructor(private stage){this.canvas=document.createElement('canvas');this.canvas.className='gc-scene-transition';this.canvas.hidden=true;stage.append(this.canvas);}
  image(url){if(!this.images.has(url))this.images.set(url,new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('转场素材读取失败。'));image.src=url;}));return this.images.get(url);}
  size(){const width=Math.max(1,Math.round(Math.min(1280,this.stage.clientWidth||1280))),height=Math.round(width*9/16);if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}return {width,height};}
  hold(snapshot){this.cancel();if(!snapshot){this.clear();return;}const {width,height}=this.size(),ctx=this.canvas.getContext('2d');if(!ctx)return;ctx.clearRect(0,0,width,height);ctx.drawImage(snapshot,0,0,width,height);this.canvas.hidden=false;}
  async run({snapshot=null,mask=null,color='#000',from=0,to=1,duration=0}:any){
    this.cancel();const generation=this.generation,{width,height}=this.size(),ctx=this.canvas.getContext('2d');if(!ctx)return;
    let maskData=null,maskCanvas=null,maskCtx=null;
    if(mask){
      const image=await this.image(mask);if(generation!==this.generation)return;maskCanvas=document.createElement('canvas');maskCanvas.width=640;maskCanvas.height=360;maskCtx=maskCanvas.getContext('2d',{willReadFrequently:true});maskCtx.drawImage(image,0,0,640,360);maskData=maskCtx.getImageData(0,0,640,360);
    }
    const levels=maskData?new Uint8Array(maskData.data.filter((_,i)=>i%4===0)):null;
    const paint=progress=>{
      ctx.clearRect(0,0,width,height);this.canvas.hidden=progress<=0;
      if(snapshot)ctx.drawImage(snapshot,0,0,width,height);else{ctx.fillStyle=color;ctx.fillRect(0,0,width,height);}
      ctx.globalCompositeOperation='destination-in';
      if(maskData){for(let i=0;i<levels.length;i++)maskData.data[i*4+3]=Math.max(0,Math.min(255,(progress*275-levels[i])*12.75));maskCtx.putImageData(maskData,0,0);ctx.drawImage(maskCanvas,0,0,width,height);}
      else{ctx.fillStyle=`rgba(0,0,0,${progress})`;ctx.fillRect(0,0,width,height);}
      ctx.globalCompositeOperation='source-over';
    };
    if(!(duration>0)){paint(to);return;}
    await new Promise<void>(resolve=>{let start;this.finish=()=>{cancelAnimationFrame(this.frame);paint(to);this.finish=null;resolve();};const tick=time=>{start??=time;const progress=Math.min(1,(time-start)/duration);paint(from+(to-from)*progress);if(progress===1){this.finish=null;resolve();}else this.frame=requestAnimationFrame(tick);};this.frame=requestAnimationFrame(tick);});
  }
  cancel(){this.generation++;this.finish?.();this.finish=null;cancelAnimationFrame(this.frame);}
  clear(){this.cancel();this.canvas.hidden=true;}
  destroy(){this.clear();this.images.clear();this.canvas.remove();}
}

export function drawCover(ctx,image,width,height,placement:any={}){
  placement||={};
  const iw=image.videoWidth||image.naturalWidth||image.width,ih=image.videoHeight||image.naturalHeight||image.height;if(!iw||!ih)return;
  const scale=Math.max(width/iw,height/ih),sx=placement.scaleX??1,sy=placement.scaleY??1;
  const w=iw*scale*sx,h=ih*scale*sy;ctx.drawImage(image,(width-w)/2+(placement.x||0)*width/1920,(height-h)/2-(placement.y||0)*height/1080,w,h);
}
