import {particleCurve,particleGradient} from './click-effect.ts';
const random=seed=>{const x=Math.sin(seed*12.9898+78.233)*43758.5453;return x-Math.floor(x);};
function sample(spec,time,seed){if(!spec)return 0;if(spec.minMaxState===3)return (spec.minScalar??spec.scalar)+(spec.scalar-(spec.minScalar??spec.scalar))*random(seed);return particleCurve(spec,time);}
// Sprite particles use the original textures, emission, colors and lifetime
// curves. Mesh particles and shader distortion still require Unity rendering.
export class StoryParticles{
  declare host: any;
  declare data: any;
  declare clock: any;
  declare start: any;
  declare images: any;
  declare disposed: any;
  declare canvas: any;
  declare ready: any;
  declare frame: any;

  constructor(host,data,{asset,clock,start=0}){this.host=host;this.data=data;this.clock=clock;this.start=start;this.images=new Map();this.disposed=false;this.canvas=document.createElement('canvas');this.canvas.width=1920;this.canvas.height=1080;this.canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';host.append(this.canvas);
    this.ready=Promise.all([...new Set<string>(data.layers.map(l=>l.file))].map(file=>new Promise<void>((resolve,reject)=>{const image=new Image();image.onload=()=>{this.images.set(file,image);resolve();};image.onerror=()=>reject(new Error('剧情粒子贴图读取失败。'));image.src=asset(file);}))).then(()=>{if(!this.disposed)this.draw();});
  }
  draw(){if(this.disposed)return;const ctx=this.canvas.getContext('2d');if(!ctx)return;ctx.clearRect(0,0,1920,1080);const elapsed=this.clock()-this.start;
    for(const [layerIndex,l]of this.data.layers.entries()){
      const initial=l.InitialModule,emission=l.EmissionModule,delay=sample(l.startDelay,0,layerIndex),time=elapsed-delay;if(time<0)continue;
      const rate=Math.max(0,sample(emission.rateOverTime,0,layerIndex)),life=Math.max(.01,initial.startLifetime.scalar||1),windowStart=Math.max(0,time-life),seeds=[];
      if(rate)for(let index=Math.max(0,Math.floor(windowStart*rate));index<=Math.min(Math.floor(time*rate),Math.floor(windowStart*rate)+300);index++){const born=index/rate;if(l.looping||born<l.lengthInSec)seeds.push([index,born]);}
      const cycles=l.looping?Math.floor(time/l.lengthInSec):0;for(let cycle=Math.max(0,cycles-Math.ceil(life/l.lengthInSec));cycle<=cycles;cycle++)for(const burst of emission.m_Bursts||[]){const born=cycle*l.lengthInSec+burst.time;if(born>time||born<windowStart)continue;for(let i=0;i<Math.min(300,sample(burst.countCurve,0,i));i++)seeds.push([10000+cycle*1000+i,born]);}
      ctx.globalCompositeOperation=l.floats?._DstBlend===1?'lighter':'source-over';
      for(const [id,born]of seeds){const seed=id+layerIndex*541,age=time-born,lifetime=sample(initial.startLifetime,0,seed),t=age/lifetime;if(t<0||t>1)continue;const shape=l.ShapeModule,angle=random(seed+1)*Math.PI*2;
        let x=l.position[0],y=l.position[1];if(shape.enabled){const radius=sample(shape.radius,0,seed+2)||shape.radius?.scalar||1;x+=Math.cos(angle)*radius*(shape.m_Scale?.x||1)*random(seed+3);y+=Math.sin(angle)*radius*(shape.m_Scale?.y||1)*random(seed+3);}
        const velocity=l.VelocityModule;if(velocity?.enabled){x+=sample(velocity.x,t,seed+4)*age;y+=sample(velocity.y,t,seed+5)*age;}else {const speed=sample(initial.startSpeed,0,seed+6);x+=Math.cos(angle)*speed*age;y+=Math.sin(angle)*speed*age;}
        const factor=l.SizeModule?.enabled?sample(l.SizeModule.curve,t,seed):1,size=sample(initial.startSize,0,seed+7)*factor*108*Math.abs(l.scale[0]),sy=initial.size3D?sample(initial.startSizeY,0,seed+7)*factor*108*Math.abs(l.scale[1]):size;if(!(size>0&&sy>0))continue;
        const color=initial.startColor.maxColor||{a:1},alpha=color.a*(l.ColorModule?.enabled?particleGradient(l.ColorModule.gradient.maxGradient,t,true):1);ctx.globalAlpha=Math.max(0,Math.min(1,alpha));
        ctx.save();ctx.translate(960+x*108,540-y*108);ctx.rotate(sample(initial.startRotation,0,seed+8)+(l.RotationModule?.enabled?sample(l.RotationModule.curve,t,seed)*age:0));ctx.drawImage(this.images.get(l.file),-size/2,-sy/2,size,sy);ctx.restore();
      }
    }this.frame=requestAnimationFrame(()=>this.draw());
  }
  destroy(){this.disposed=true;cancelAnimationFrame(this.frame);this.canvas.remove();this.images.clear();}
}
