// DOTABYSS's R18 camera: linear compositing, URP Gaussian bloom and chroma.
// Parameters come from the model's VolumeProfile, never a global blur preset.
export const srgbToLinear=value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
export function postProcessSettings(data){
  if(data?.version!==1||data.colorSpace!=='linear')throw new Error('DOTABYSS 后处理数据无效。');
  const b=data.bloom||{},tint=(b.tint||[1,1,1]).map(srgbToLinear),luma=tint[0]*.2126+tint[1]*.7152+tint[2]*.0722;
  const settings={threshold:srgbToLinear(b.threshold??1),intensity:b.intensity??0,scatter:.05+.9*(b.scatter??.7),clamp:b.clamp??65472,tint:luma>0?tint.map(v=>v/luma):[1,1,1],chroma:(data.chromaticAberration??0)*.05,downscale:b.downscale===1?4:2,iterations:Math.max(1,Math.min(6,b.maxIterations??6)),skip:Math.max(0,b.skipIterations??1)};
  if(![settings.threshold,settings.intensity,settings.scatter,settings.clamp,settings.chroma,settings.iterations,settings.skip,...settings.tint].every(v=>Number.isFinite(v)&&v>=0))throw new Error('DOTABYSS 后处理参数无效。');
  return settings;
}
export const postVertex=`attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`;
export const postFragment=`
precision highp float;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform sampler2D uLow;
uniform vec2 uTexel;
uniform vec3 uTint;
uniform float uThreshold;
uniform float uClamp;
uniform float uScatter;
uniform float uIntensity;
uniform float uChroma;
uniform int uPass;
vec4 sampleAt(vec2 uv){return texture2D(uTexture,clamp(uv,uTexel*.5,1.-uTexel*.5));}
vec3 encode(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
void main(){
  vec4 source=sampleAt(vUv);
  if(uPass==0){
    vec3 c=min(source.rgb,vec3(uClamp));float brightness=max(max(c.r,c.g),c.b),knee=uThreshold*.5;
    float soft=clamp(brightness-uThreshold+knee,0.,2.*knee);soft=soft*soft/(4.*knee+.0001);
    gl_FragColor=vec4(max(c,vec3(0.))*max(brightness-uThreshold,soft)/max(brightness,.0001),1.);
  }else if(uPass==1){
    vec2 d=vec2(uTexel.x*2.,0.);
    vec3 c=source.rgb*.22702703;
    c+=(sampleAt(vUv-d).rgb+sampleAt(vUv+d).rgb)*.19459459;
    c+=(sampleAt(vUv-d*2.).rgb+sampleAt(vUv+d*2.).rgb)*.12162162;
    c+=(sampleAt(vUv-d*3.).rgb+sampleAt(vUv+d*3.).rgb)*.05405405;
    c+=(sampleAt(vUv-d*4.).rgb+sampleAt(vUv+d*4.).rgb)*.01621622;
    gl_FragColor=vec4(c,1.);
  }else if(uPass==2){
    vec2 d=vec2(0.,uTexel.y);vec3 c=source.rgb*.22702703;
    c+=(sampleAt(vUv-d*1.38461538).rgb+sampleAt(vUv+d*1.38461538).rgb)*.31621622;
    c+=(sampleAt(vUv-d*3.23076923).rgb+sampleAt(vUv+d*3.23076923).rgb)*.07027027;
    gl_FragColor=vec4(c,1.);
  }else if(uPass==3){
    gl_FragColor=vec4(mix(source.rgb,texture2D(uLow,vUv).rgb,uScatter),1.);
  }else{
    vec2 coords=2.*vUv-1.,delta=-coords*dot(coords,coords)*uChroma/3.;
    vec3 c=vec3(source.r,sampleAt(vUv+delta).g,sampleAt(vUv+2.*delta).b);
    c+=texture2D(uLow,vUv).rgb*uIntensity*uTint;
    float alpha=clamp(source.a,0.,1.);
    gl_FragColor=vec4(encode(c/max(alpha,.00001))*alpha,alpha);
  }
}`;

export class DotabyssPostProcess{
  declare settings: any;
  declare targets: any;
  declare gl: any;
  declare program: any;
  declare uniforms: any;
  declare vertices: any;
  declare hdr: any;
  declare scene: any;
  declare levels: any;

  constructor(data){this.settings=postProcessSettings(data);this.targets=[];}
  prepare(gl){
    if(this.gl===gl&&this.program)return;this.destroy();this.gl=gl;
    const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error('DOTABYSS 后处理编译失败：'+message);}return shader;};
    const shaders=[];let program;
    try{shaders.push(compile(gl.VERTEX_SHADER,postVertex),compile(gl.FRAGMENT_SHADER,postFragment));program=gl.createProgram();shaders.forEach(s=>gl.attachShader(program,s));gl.bindAttribLocation(program,0,'aPosition');gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));this.program=program;}
    catch(error){if(program)gl.deleteProgram(program);throw error;}finally{shaders.forEach(s=>gl.deleteShader(s));}
    this.uniforms=Object.fromEntries(['uTexture','uLow','uTexel','uTint','uThreshold','uClamp','uScatter','uIntensity','uChroma','uPass'].map(name=>[name,gl.getUniformLocation(program,name)]));
    this.vertices=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.vertices);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    this.hdr=!!(gl.RGBA16F&&gl.getExtension('EXT_color_buffer_float'));
  }
  target(width,height){
    const gl=this.gl,texture=gl.createTexture(),framebuffer=gl.createFramebuffer(),target={width,height,texture,framebuffer};this.targets.push(target);
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,this.hdr?gl.RGBA16F:gl.RGBA,width,height,0,gl.RGBA,this.hdr?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('DOTABYSS 后处理缓冲区不可用。');
    return target;
  }
  resize(width,height){
    if(this.scene?.width===width&&this.scene?.height===height)return;
    this.releaseTargets();this.scene=this.target(width,height);this.levels=[];
    if(!(this.settings.intensity>0))return;
    let w=Math.max(1,Math.floor(width/this.settings.downscale)),h=Math.max(1,Math.floor(height/this.settings.downscale));
    const count=Math.max(1,Math.min(this.settings.iterations,Math.floor(Math.log2(Math.max(w,h)))-1-this.settings.skip));
    for(let i=0;i<count;i++){this.levels.push({down:this.target(w,h),temporary:i?this.target(w,h):null,up:i<count-1?this.target(w,h):null});w=Math.max(1,w>>1);h=Math.max(1,h>>1);}
  }
  pass(mode,input,output,low=input,viewport?: any){
    const gl=this.gl,u=this.uniforms,s=this.settings;
    gl.bindFramebuffer(gl.FRAMEBUFFER,output?.framebuffer??null);gl.viewport(...(viewport||[0,0,output.width,output.height]));
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.colorMask(true,true,true,true);
    if(mode===4){gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);}else gl.disable(gl.BLEND);
    gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.vertices);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input.texture);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,low.texture);
    gl.uniform1i(u.uTexture,0);gl.uniform1i(u.uLow,1);gl.uniform2fv(u.uTexel,[1/input.width,1/input.height]);gl.uniform3fv(u.uTint,s.tint);gl.uniform1f(u.uThreshold,s.threshold);gl.uniform1f(u.uClamp,s.clamp);gl.uniform1f(u.uScatter,s.scatter);gl.uniform1f(u.uIntensity,s.intensity);gl.uniform1f(u.uChroma,s.chroma);gl.uniform1i(u.uPass,mode);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.useProgram(null);
  }
  render(renderer,draw){
    const gl=renderer.gl,framebuffer=gl.getParameter(gl.FRAMEBUFFER_BINDING),viewport=Array.from(gl.getParameter(gl.VIEWPORT));
    try{
      this.prepare(gl);this.resize(viewport[2],viewport[3]);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.scene.framebuffer);gl.viewport(0,0,this.scene.width,this.scene.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      renderer.setRenderState(this.scene.framebuffer,[0,0,this.scene.width,this.scene.height]);draw();
      let bloom=this.scene;
      if(this.levels.length){
        this.pass(0,this.scene,this.levels[0].down);
        for(let i=1;i<this.levels.length;i++){const level=this.levels[i];this.pass(1,this.levels[i-1].down,level.temporary);this.pass(2,level.temporary,level.down);}
        bloom=this.levels.at(-1).down;
        for(let i=this.levels.length-2;i>=0;i--){this.pass(3,this.levels[i].down,this.levels[i].up,bloom);bloom=this.levels[i].up;}
      }
      this.pass(4,this.scene,{framebuffer},bloom,viewport);
    }finally{renderer.setRenderState(framebuffer,viewport);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.viewport(...viewport);}
  }
  releaseTargets(){if(this.gl)for(const target of this.targets){this.gl.deleteFramebuffer(target.framebuffer);this.gl.deleteTexture(target.texture);}this.targets=[];this.scene=null;this.levels=[];}
  destroy(){this.releaseTargets();if(this.gl){if(this.program)this.gl.deleteProgram(this.program);if(this.vertices)this.gl.deleteBuffer(this.vertices);}this.gl=null;this.program=null;this.vertices=null;}
}
