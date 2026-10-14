// DOTABYSS uses Unity materials in addition to the blend flags inside the MOC.
// These equations follow its bundled Live2DUnlit and Live2DMosaicV2 shaders.
import { DotabyssPostProcess } from './post-process.ts';
export const vertexShader = `
attribute vec2 aPosition;
attribute vec2 aUv;
uniform mat4 uMatrix;
uniform mat4 uClipMatrix;
varying vec2 vUv;
varying vec4 vClip;
void main(){
  vec4 position=vec4(aPosition,0.0,1.0);
  gl_Position=uMatrix*position;
  vClip=uClipMatrix*position;
  vUv=vec2(aUv.x,1.0-aUv.y);
}`;

export const fragmentShader = `
precision highp float;
varying vec2 vUv;
varying vec4 vClip;
uniform sampler2D uTexture;
uniform sampler2D uMask;
uniform sampler2D uScene;
uniform vec4 uTint;
uniform vec4 uModelColor;
uniform vec3 uMultiply;
uniform vec3 uScreen;
uniform vec3 uEmission;
uniform vec4 uMaskChannel;
uniform vec4 uMaskBounds;
uniform vec4 uViewport;
uniform vec2 uOffset;
uniform float uSize;
uniform bool uMasked;
uniform bool uInverted;
uniform bool uMosaic;
uniform bool uMaskPass;
uniform bool uLinear;
vec3 decodeSrgb(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
void main(){
  vec4 tex=texture2D(uTexture,vUv);
  if(uMaskPass){
    vec2 position=vClip.xy/vClip.w;
    vec2 inside=step(uMaskBounds.xy,position)*step(position,uMaskBounds.zw);
    gl_FragColor=uMaskChannel*tex.a*inside.x*inside.y;
    return;
  }
  // Pixi uploads premultiplied PNGs; Unity's shader starts with straight RGB.
  tex.rgb=tex.a>0.00001?tex.rgb/tex.a:vec3(0.0);
  if(uLinear)tex.rgb=decodeSrgb(tex.rgb);
  float mask=1.0;
  if(uMasked){
    mask=dot(vec4(1.0)-texture2D(uMask,vClip.xy/vClip.w),uMaskChannel);
    if(uInverted)mask=1.0-mask;
  }
  vec4 result;
  if(uMosaic){
    vec3 rgb=tex.rgb*uMultiply;
    rgb=(rgb+uScreen-rgb*uScreen)*uTint.rgb;
    float alpha=tex.a*uTint.a;
    vec4 coverage=vec4(rgb*alpha,alpha)*mask*uModelColor.a;
    // The red atlas mesh marks coverage. It is never a source-color pass.
    if(coverage.r>0.0)coverage=coverage.aaaa;
    vec2 uv=(gl_FragCoord.xy-uViewport.xy)/uViewport.zw;
    uv=floor(uv*1000.0/uSize)*uSize/1000.0+uOffset;
    result=coverage*texture2D(uScene,uv);
  }else{
    vec4 tinted=tex*uTint;
    vec3 rgb=tinted.rgb*uMultiply;
    rgb=(rgb+uScreen-rgb*uScreen)*uTint.rgb;
    float alpha=(2.0*tinted.a-tinted.a*tinted.a)*uTint.a;
    vec4 color=vec4(rgb*alpha,alpha)*mask*uModelColor.a;
    // Original Unity material applies this extra opacity stage to soft FX.
    result=vec4((color.rgb+uEmission)*color.a,color.a*color.a);
  }
  result.rgb*=uModelColor.rgb;
  gl_FragColor=result;
}`;

const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const color=value=>[value.R,value.G,value.B,value.A];

export function orderedDrawables(orders,profiles){
  const sorted=Array.from(orders,(_,i)=>i).sort((a,b)=>profiles[a].queue-profiles[b].queue||orders[a]-orders[b]);
  const ranks=new Int32Array(orders.length);sorted.forEach((index,rank)=>{ranks[index]=rank;});return ranks;
}

export class DotabyssMaterialRenderer {
  declare internal: any;
  declare renderer: any;
  declare core: any;
  declare meshes: any;
  declare profiles: any;
  declare postProcess: any;
  declare original: any;
  declare captured: any;
  declare gl: any;
  declare program: any;
  declare uniforms: any;
  declare buffers: any;
  declare blends: any;
  declare viewport: any;
  declare scene: any;
  declare sceneWidth: any;
  declare sceneHeight: any;

  constructor(internal,data){
    if(data?.version!==1||data.game!=='dotabyss'||!data.materials||!data.drawables)throw new Error('DOTABYSS 材质数据无效，请重新整理动态 CG。');
    this.internal=internal;this.renderer=internal.renderer;this.core=internal.coreModel;this.meshes=new WeakMap();
    // getDrawableIds() returns CubismId objects, not native string IDs.
    this.profiles=Array.from({length:this.core.getDrawableCount()},(_,index)=>{
      const id=this.core.getDrawableId(index);
      const draw=data.drawables[id],material=draw&&data.materials[draw.material];
      if(!material||!['unlit','mosaic'].includes(material.shader)||!Number.isFinite(material.queue)||!Array.isArray(material.blend)||material.blend.length!==4||material.blend.some(n=>!Number.isInteger(n)||n<0||n>10)||!Array.isArray(draw.color)||draw.color.length!==4||draw.color.some(n=>!Number.isFinite(n))||!Number.isInteger(draw.texture)||draw.texture<0)throw new Error('DOTABYSS 图层材质不完整。');
      if(material.shader==='mosaic'&&(!(material.size>0)||!Array.isArray(material.offset)||material.offset.length!==2||material.offset.some(n=>!Number.isFinite(n))))throw new Error('DOTABYSS 马赛克参数不完整。');
      const profile={...material,...draw};this.meshes.set(this.core.getDrawableVertexIndices(index),profile);return profile;
    });
    this.postProcess=data.postProcessing?new DotabyssPostProcess(data.postProcessing):null;
    const renderer=this.renderer,core=this.core;
    // Unity uses a 2048 atlas divided into 256px mask tiles. Cubism Web's
    // default 256 atlas shares that space among every mouth/eye/other mask.
    renderer.setClippingMaskBufferSize?.(1024);
    this.original={drawMesh:renderer.drawMesh,doDrawModel:renderer.doDrawModel,orders:core.getDrawableRenderOrders,context:internal.updateWebGLContext};
    if(this.original.context)internal.updateWebGLContext=(...args)=>{this.release();return this.original.context.apply(internal,args);};
    core.getDrawableRenderOrders=()=>orderedDrawables(this.original.orders.call(core),this.profiles);
    renderer.doDrawModel=()=>{
      this.captured=false;
      if(!renderer.gl)return this.original.doDrawModel.call(renderer);
      this.prepare(renderer.gl);
      const gl=this.gl,active=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE2);
      const texture=gl.getParameter(gl.TEXTURE_BINDING_2D);gl.activeTexture(active);
      try{return this.postProcess?this.postProcess.render(renderer,()=>this.original.doDrawModel.call(renderer)):this.original.doDrawModel.call(renderer);}
      finally{gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,texture);gl.activeTexture(active);}
    };
    renderer.drawMesh=(...args)=>{
      const profile=this.meshes.get(args[3]);if(!profile)throw new Error('DOTABYSS 图层材质绑定丢失。');
      // Unity sums source alpha (Blend One One), including invisible source
      // meshes. Web's default product leaves holes where soft masks overlap.
      const mask=renderer.getClippingContextBufferForMask();
      try{this.draw(profile,args,mask);}finally{renderer.setClippingContextBufferForDraw(null);renderer.setClippingContextBufferForMask(null);}
    };
  }
  prepare(gl){
    if(this.gl===gl&&this.program)return;
    this.release();this.gl=gl;
    const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error('DOTABYSS 材质编译失败：'+error);}return shader;};
    const shaders=[];let program;
    try{
      shaders.push(compile(gl.VERTEX_SHADER,vertexShader));shaders.push(compile(gl.FRAGMENT_SHADER,fragmentShader));
      program=gl.createProgram();shaders.forEach(shader=>gl.attachShader(program,shader));
      gl.bindAttribLocation(program,0,'aPosition');gl.bindAttribLocation(program,1,'aUv');gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('DOTABYSS 材质链接失败：'+gl.getProgramInfoLog(program));
      this.program=program;
    }catch(error){if(program)gl.deleteProgram(program);throw error;}finally{shaders.forEach(shader=>gl.deleteShader(shader));}
    this.uniforms=Object.fromEntries(['uMatrix','uClipMatrix','uTexture','uMask','uScene','uTint','uModelColor','uMultiply','uScreen','uEmission','uMaskChannel','uMaskBounds','uViewport','uOffset','uSize','uMasked','uInverted','uMosaic','uMaskPass','uLinear'].map(name=>[name,gl.getUniformLocation(program,name)]));
    this.buffers={vertex:gl.createBuffer(),uv:gl.createBuffer(),index:gl.createBuffer()};
    this.blends=[gl.ZERO,gl.ONE,gl.DST_COLOR,gl.SRC_COLOR,gl.ONE_MINUS_DST_COLOR,gl.SRC_ALPHA,gl.ONE_MINUS_SRC_COLOR,gl.DST_ALPHA,gl.ONE_MINUS_DST_ALPHA,gl.SRC_ALPHA_SATURATE,gl.ONE_MINUS_SRC_ALPHA];
  }
  capture(){
    if(this.captured)return;
    const gl=this.gl;this.viewport=Array.from(gl.getParameter(gl.VIEWPORT));
    const [x,y,width,height]=this.viewport;gl.activeTexture(gl.TEXTURE2);
    if(!this.scene){this.scene=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.scene);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}
    gl.bindTexture(gl.TEXTURE_2D,this.scene);
    if(this.sceneWidth!==width||this.sceneHeight!==height){const hdr=this.postProcess?.hdr;gl.texImage2D(gl.TEXTURE_2D,0,hdr?gl.RGBA16F:gl.RGBA,width,height,0,gl.RGBA,hdr?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);this.sceneWidth=width;this.sceneHeight=height;}
    // One camera snapshot after base layers, before every mosaic/front layer.
    // A separate texture avoids reading from the active render target.
    gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,x,y,width,height);this.captured=true;
  }
  draw(profile,args,mask=null){
    const [,indexCount,,indices,vertices,uvs,multiply,screen,opacity,,inverted]=args;
    const gl=this.renderer.gl;this.prepare(gl);
    if(!mask&&profile.shader==='mosaic')this.capture();
    const u=this.uniforms,renderer=this.renderer,clip=renderer.getClippingContextBufferForDraw();
    gl.useProgram(this.program);
    for(const [name,location,data]of [['vertex',0,vertices],['uv',1,uvs]]){gl.bindBuffer(gl.ARRAY_BUFFER,this.buffers[name]);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);}
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.buffers.index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,renderer._textures[profile.texture]);gl.uniform1i(u.uTexture,0);
    gl.activeTexture(gl.TEXTURE1);
    if(clip&&!mask){
      const manager=clip.getClippingManager();gl.bindTexture(gl.TEXTURE_2D,manager.getColorBuffer()[clip._bufferIndex]);
      gl.uniformMatrix4fv(u.uClipMatrix,false,clip._matrixForDraw.getArray());gl.uniform4fv(u.uMaskChannel,color(manager.getChannelFlagAsColor(clip._layoutChannelNo)));
    }else{gl.bindTexture(gl.TEXTURE_2D,renderer._textures[profile.texture]);gl.uniformMatrix4fv(u.uClipMatrix,false,identity);gl.uniform4fv(u.uMaskChannel,[0,0,0,0]);}
    gl.uniform1i(u.uMask,1);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.scene||renderer._textures[profile.texture]);gl.uniform1i(u.uScene,2);
    gl.uniformMatrix4fv(u.uMatrix,false,(mask?mask._matrixForMask:renderer.getMvpMatrix()).getArray());
    if(mask){
      const rect=mask._layoutBounds;
      gl.uniformMatrix4fv(u.uClipMatrix,false,mask._matrixForMask.getArray());gl.uniform4fv(u.uMaskChannel,color(mask.getClippingManager().getChannelFlagAsColor(mask._layoutChannelNo)));
      gl.uniform4fv(u.uMaskBounds,[rect.x*2-1,rect.y*2-1,(rect.x+rect.width)*2-1,(rect.y+rect.height)*2-1]);
    }else gl.uniform4fv(u.uMaskBounds,[-1,-1,1,1]);
    gl.uniform4fv(u.uTint,[...profile.color.slice(0,3),profile.color[3]*opacity]);gl.uniform4fv(u.uModelColor,color(renderer.getModelColor()));
    gl.uniform3fv(u.uMultiply,(profile.multiply||color(multiply)).slice(0,3));gl.uniform3fv(u.uScreen,(profile.screen||color(screen)).slice(0,3));gl.uniform3fv(u.uEmission,profile.emission||[0,0,0]);
    gl.uniform1i(u.uLinear,!!this.postProcess);gl.uniform1i(u.uMaskPass,!!mask);gl.uniform1i(u.uMasked,!!clip&&!mask);gl.uniform1i(u.uInverted,!!inverted);gl.uniform1i(u.uMosaic,profile.shader==='mosaic'&&!mask);
    gl.uniform4fv(u.uViewport,this.viewport||[0,0,1,1]);gl.uniform2fv(u.uOffset,profile.offset||[0,0]);gl.uniform1f(u.uSize,profile.size||10);
    const previousCull=profile.cull?gl.getParameter(gl.CULL_FACE_MODE):null;
    if(profile.cull){gl.enable(gl.CULL_FACE);renderer._updateFrontFaceByMatrix(renderer.getMvpMatrix());gl.cullFace(profile.cull===1?gl.FRONT:gl.BACK);}else gl.disable(gl.CULL_FACE);
    const equations=mask?[gl.getParameter(gl.BLEND_EQUATION_RGB),gl.getParameter(gl.BLEND_EQUATION_ALPHA)]:null;
    try{
      if(mask){
        // Keep the SDK's white-clear/inverse texture convention: subtracting
        // each alpha gives 1 - clamp(sum(alpha)), exactly Unity's additive mask.
        gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);gl.blendFuncSeparate(gl.ONE,gl.ONE,gl.ONE,gl.ONE);
      }else gl.blendFuncSeparate(...profile.blend.map(value=>this.blends[value]));
      gl.drawElements(gl.TRIANGLES,indexCount,gl.UNSIGNED_SHORT,0);
    }finally{if(equations)gl.blendEquationSeparate(...equations);if(previousCull!==null)gl.cullFace(previousCull);gl.useProgram(null);}
  }
  release(){
    this.postProcess?.destroy();
    const gl=this.gl;if(gl){if(this.program)gl.deleteProgram(this.program);if(this.scene)gl.deleteTexture(this.scene);for(const buffer of Object.values<any>(this.buffers||{}))gl.deleteBuffer(buffer);}
    this.gl=null;this.program=null;this.scene=null;this.buffers=null;this.sceneWidth=0;this.sceneHeight=0;this.captured=false;
  }
  destroy(){
    this.renderer.drawMesh=this.original.drawMesh;this.renderer.doDrawModel=this.original.doDrawModel;this.core.getDrawableRenderOrders=this.original.orders;
    if(this.original.context)this.internal.updateWebGLContext=this.original.context;this.release();
  }
}
