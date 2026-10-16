// Prepare the next decoded frame behind the current video. Replacing src on
// the visible element clears its compositor frame and causes a black flash.
export class VideoPlayer {
  generation=0;model:any;options:any;video:any;file:any;token:any;name:any;pending:any;cancelLoad:any;endWaiters=new Set<()=>void>();
  constructor(private container){}
  async load(model,options:any={}){this.model=model;this.options=options;return this.select(options.animation||model.animations?.[0],options.loop??true,options.token);}
  createVideo(){
    const video=document.createElement('video');video.className='vault-video-player';video.playsInline=true;video.muted=true;video.preload='auto';video.tabIndex=-1;video.setAttribute('aria-hidden','true');
    video.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-position:center;opacity:0;';video.style.objectFit=this.options.fit==='cover'?'cover':'contain';
    if(this.options.controls===false){video.style.pointerEvents='none';video.disablePictureInPicture=true;video.disableRemotePlayback=true;}
    this.container.append(video);return video;
  }
  release(video){if(!video)return;video.pause();video.removeAttribute('src');video.load();video.remove();}
  cancelEndWait(){for(const done of this.endWaiters)done();}
  select(name,loop=true,token=null){
    const track=this.model.tracks?.find(t=>t.name===name)||this.model.tracks?.[0]||{file:this.model.file,name};
    if(this.pending?.file===track.file&&this.pending.name===track.name&&this.pending.token===token){this.pending.video.loop=loop;return this.pending.promise;}
    this.generation++;this.cancelLoad?.();this.cancelEndWait();
    if(this.file===track.file&&this.video){
      this.video.loop=loop;if(token!==this.token||track.name!==this.name){this.video.currentTime=0;this.video.play().catch(()=>{});}this.token=token;this.name=track.name;return Promise.resolve();
    }
    const generation=this.generation,video=this.createVideo();video.loop=loop;
    const pending={video,file:track.file,name:track.name,token,promise:null};this.pending=pending;
    pending.promise=new Promise<void>((resolve,reject)=>{
      let frame=null,ready=false,settled=false;
      const cleanup=()=>{settled=true;video.removeEventListener('loadeddata',loaded);video.removeEventListener('error',failed);if(frame!==null)video.cancelVideoFrameCallback?.(frame);clearTimeout(timer);if(this.cancelLoad===cancel)this.cancelLoad=null;if(this.pending===pending)this.pending=null;};
      const cancel=()=>{if(settled)return;cleanup();this.release(video);resolve();};
      const commit=()=>{
        if(settled)return;if(generation!==this.generation)return cancel();cleanup();const old=this.video;
        this.video=video;this.file=track.file;this.name=track.name;this.token=token;video.controls=this.options.controls!==false;video.tabIndex=video.controls?0:-1;video.removeAttribute('aria-hidden');video.setAttribute('aria-label',video.controls?'视频 CG':'剧情画面');video.style.opacity='1';this.release(old);resolve();
      };
      const loaded=()=>{
        if(ready)return;ready=true;
        // Metadata has no decoded pixels. Wait for presentation before replacing
        // the old element, including the last frame of a completed wait clip.
        if(video.requestVideoFrameCallback)frame=video.requestVideoFrameCallback(commit);else commit();
        video.play().catch(failed);
      };
      const failed=()=>{if(settled)return;cleanup();this.release(video);reject(new Error('CG 视频读取失败。'));};
      const timer=setTimeout(failed,30000);this.cancelLoad=cancel;
      video.addEventListener('loadeddata',loaded);video.addEventListener('error',failed);
      video.src=(this.options.assetRoot||'library/')+track.file.split('/').map(encodeURIComponent).join('/');video.load();
    });
    return pending.promise;
  }
  waitForEnd(){
    const video=this.video;if(!video||video.ended)return Promise.resolve();
    return new Promise<void>((resolve,reject)=>{
      const cleanup=()=>{video.removeEventListener('ended',done);video.removeEventListener('error',failed);this.endWaiters.delete(done);};
      const done=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('CG 视频播放中断。'));};
      this.endWaiters.add(done);video.addEventListener('ended',done);video.addEventListener('error',failed);
    });
  }
  setAnimation(name,loop=true,token=null){this.select(name,loop,token).catch(()=>{});}
  fit(){}
  destroy(){this.generation++;this.cancelLoad?.();this.cancelEndWait();this.release(this.video);this.video=null;this.file=null;this.name=null;}
}
