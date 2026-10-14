const schedule=(run,delay)=>globalThis.setTimeout(run,delay),cancel=id=>globalThis.clearTimeout(id);
export class HoldForward{
  declare active: any;
  declare pointer: any;
  declare suppressUntil: any;
  declare down: any;
  declare origin: any;
  declare timer: any;
  declare setTimer: any;
  declare onChange: any;
  declare move: any;
  declare up: any;
  declare click: any;
  declare now: any;
  declare context: any;
  declare blur: any;
  declare visibility: any;
  declare onAdvance: any;
  declare repeat: any;
  declare interval: any;
  declare clearTimer: any;
  declare root: any;

  constructor(root,{canStart,onChange,onAdvance,setTimer=schedule,clearTimer=cancel,now=()=>performance.now(),holdDelay=400,interval=90}){
    Object.assign(this,{root,canStart,onChange,onAdvance,setTimer,clearTimer,now,holdDelay,interval});this.active=false;this.pointer=null;this.suppressUntil=0;
    this.down=e=>{if(e.button!==0||e.isPrimary===false||this.pointer!==null||!canStart(e))return;this.suppressUntil=0;this.pointer=e.pointerId;this.origin=[e.clientX,e.clientY];try{root.setPointerCapture?.(e.pointerId);}catch{}
      this.timer=this.setTimer(()=>{this.timer=null;if(this.pointer===null)return;this.active=true;this.suppressUntil=Infinity;this.onChange(true);this.tick();},holdDelay);};
    this.move=e=>{if(e.pointerId!==this.pointer)return;const r=root.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom||!this.active&&Math.hypot(e.clientX-this.origin[0],e.clientY-this.origin[1])>12)this.stop();};
    this.up=e=>{if(e.pointerId===this.pointer)this.stop();};
    this.click=e=>{if(this.now()<this.suppressUntil){this.suppressUntil=0;e.preventDefault();e.stopImmediatePropagation();}};
    this.context=e=>{if(this.pointer!==null){e.preventDefault();}};
    this.blur=()=>this.stop();this.visibility=()=>{if(root.ownerDocument.hidden)this.stop();};
    for(const [type,listener]of [['pointerdown',this.down],['pointermove',this.move],['pointerup',this.up],['pointercancel',this.up],['lostpointercapture',this.up],['click',this.click],['contextmenu',this.context]])root.addEventListener(type,listener,{capture:true});
    root.ownerDocument.defaultView.addEventListener('blur',this.blur);root.ownerDocument.addEventListener('visibilitychange',this.visibility);
  }
  tick(){if(!this.active)return;this.onAdvance();if(this.active)this.repeat=this.setTimer(()=>this.tick(),this.interval);}
  stop(){if(this.timer!==null&&this.timer!==undefined)this.clearTimer(this.timer);if(this.repeat!==undefined)this.clearTimer(this.repeat);this.timer=null;this.repeat=undefined;const pointer=this.pointer;this.pointer=null;
    if(this.active){this.active=false;this.suppressUntil=this.now()+350;this.onChange(false);}try{if(pointer!==null&&this.root.hasPointerCapture?.(pointer))this.root.releasePointerCapture(pointer);}catch{}
  }
  destroy(){this.stop();for(const [type,listener]of [['pointerdown',this.down],['pointermove',this.move],['pointerup',this.up],['pointercancel',this.up],['lostpointercapture',this.up],['click',this.click],['contextmenu',this.context]])this.root.removeEventListener(type,listener,{capture:true});this.root.ownerDocument.defaultView.removeEventListener('blur',this.blur);this.root.ownerDocument.removeEventListener('visibilitychange',this.visibility);}
}
