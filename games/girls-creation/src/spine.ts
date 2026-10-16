'use strict';
// Parse metadata with the same 3.8 runtime as the viewer; no textures or canvas.
function spineMetadata(bytes){
  const core=require('@pixi-spine/runtime-3.8'),loader={};
  for(const type of ['Region','Mesh','Clipping','BoundingBox','Path','Point'])loader['new'+type+'Attachment']=(_skin,name)=>new core[type+'Attachment'](name);
  const data=new core.SkeletonBinary(loader).readSkeletonData(new Uint8Array(bytes));
  if(!/^3\.8\./.test(data.version))throw new Error('不支持的立绘 Spine 版本。');
  const animations=data.animations.map(x=>x.name);
  return {version:data.version,animations,defaultAnimation:animations.includes('loop')?'loop':animations[0]};
}
export { spineMetadata };
