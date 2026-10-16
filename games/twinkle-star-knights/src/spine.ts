export function spineMetadata(bytes: Buffer) {
  const core = require('@pixi-spine/runtime-4.1'), loader: any = {};
  for (const type of ['Region', 'Mesh', 'Clipping', 'BoundingBox', 'Path', 'Point']) loader['new' + type + 'Attachment'] = (_skin, name) => {
    const attachment = new core[type + 'Attachment'](name);
    // Metadata parsing needs UV dimensions but never a real texture or canvas.
    if (type === 'Region' || type === 'Mesh') attachment.region = { offsetX: 0, offsetY: 0, width: 1, height: 1, originalWidth: 1, originalHeight: 1, u: 0, v: 0, u2: 1, v2: 1, degrees: 0 };
    return attachment;
  };
  const data = new core.SkeletonBinary(loader).readSkeletonData(new Uint8Array(bytes));
  if (!/^4\.[01]\./.test(data.version)) throw new Error('不支持的 Spine 版本。');
  const animations = data.animations.map(a => a.name), skins = data.skins.map(s => s.name);
  return { version: data.version, animations, skins, defaultAnimation: ['wait', 'idle', 'Idle', 'loop'].find(a => animations.includes(a)) || animations.find(a => /_loop$/i.test(a)) || animations[0],
    defaultSkin: skins.includes('face1') ? 'face1' : skins[0], width: data.width, height: data.height,
    bounds: { x: data.x, y: -data.y - data.height, width: data.width, height: data.height },
    animationDurations: Object.fromEntries(data.animations.map(a => [a.name, a.duration])),
    mosaicSlots: data.slots.filter(s => /mosaic|mos_/i.test(s.name)).map(s => s.name) };
}
