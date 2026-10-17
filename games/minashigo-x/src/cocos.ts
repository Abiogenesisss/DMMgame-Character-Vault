// Read Cocos Creator 2.4's compiled JSON as data only. No client classes or
// scripts are loaded: UI extraction needs just nodes, labels and sprite frames.
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeUuid(value) {
  if (typeof value !== 'string') throw new Error('界面素材编号无效。');
  if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)) return value;
  if (!/^[a-f0-9]{2}[A-Za-z0-9+/]{20}$/.test(value)) throw new Error('界面素材编号无效。');
  let hex = value.slice(0, 2);
  for (let i = 2; i < value.length; i += 2) hex += ((BASE64.indexOf(value[i]) << 6) | BASE64.indexOf(value[i + 1])).toString(16).padStart(3, '0');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
function unpackAsset(data, index = 0) {
  if (!Array.isArray(data) || data[0] !== 1 || ![6, 11].includes(data.length)) throw new Error('界面 JSON 格式无效。');
  const file = data.length === 6 ? [...data.slice(0, 5), ...(data[5]?.[index] || [])] : data;
  if (file.length !== 11) throw new Error('界面资源包不完整。');
  const [, uuidData, stringData, classes, masks, raw, types, originalRefs, objectData, keyData, idData] = file;
  const uuids = uuidData || [], strings = stringData || [], depObjects = objectData || [], depKeys = keyData || [], depIds = idData || [];
  if (![uuids, strings, classes, raw, depObjects, depKeys, depIds].every(Array.isArray) || raw.length > 12000 || classes.length > 500
    || depObjects.length !== depKeys.length || depKeys.length !== depIds.length || depIds.length > 12000) throw new Error('界面资源结构无效。');
  const instances = [], refs = Array.isArray(originalRefs) ? [...originalRefs] : [];
  const dependencies = [...depObjects]; let count = 0;
  const key = value => { if (typeof value !== 'string' && !Number.isSafeInteger(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) throw new Error('界面属性无效。'); return value; };
  function vector(value) {
    if (!Array.isArray(value) || value.length > 17 || value.some(n => !Number.isFinite(n))) throw new Error('界面坐标无效。');
    const fields = [['x', 'y'], ['x', 'y', 'z'], ['x', 'y', 'z', 'w'], ['x', 'y', 'z', 'w'], ['rgba'], ['width', 'height'], ['x', 'y', 'width', 'height']][value[0]];
    if (!fields) return value.slice(1);
    return Object.assign(Object.create(null), Object.fromEntries(fields.map((field, i) => [field, value[i + 1]])));
  }
  function custom(type, value) {
    if (typeof type !== 'string') throw new Error('界面自定义类型无效。');
    return Object.assign(Object.create(null), value && !Array.isArray(value) && typeof value === 'object' ? value : { data: value }, { __type__: type });
  }
  function field(object, name, value, type, depth) {
    key(name); if (depth > 60 || ++count > 200000) throw new Error('界面资源嵌套过深。');
    if (type === 0) object[name] = value;
    else if (type === 1) {
      if (!Number.isSafeInteger(value)) throw new Error('界面引用无效。');
      if (value >= 0) object[name] = instances[value];
      else { const offset = 3 * ~value; if (offset >= refs.length - 1) throw new Error('界面引用越界。'); refs[offset] = object; }
    } else if (type === 2 || type === 3 || type === 9) {
      if (!Array.isArray(value)) throw new Error('界面列表无效。');
      object[name] = [];
      value.forEach((entry, i) => field(object[name], i, entry, type === 2 ? 1 : type === 3 ? 6 : 4, depth + 1));
    } else if (type === 4) object[name] = objectValue(value, depth + 1);
    else if (type === 5 || type === 8) object[name] = vector(value);
    else if (type === 6) { if (!Number.isSafeInteger(value) || value < 0 || value >= dependencies.length) throw new Error('界面素材引用越界。'); dependencies[value] = object; }
    else if (type === 7) { if (!Array.isArray(value) || value.some(n => !Number.isFinite(n))) throw new Error('界面变换无效。'); object[name] = value; }
    else if (type === 10) object[name] = custom(classes[value[0]], value[1]);
    else if (type === 11 || type === 12) {
      if (!Array.isArray(value) || value.length > 20000) throw new Error('界面字典无效。');
      object[name] = Array.isArray(value[0]) ? [...value[0]] : Object.assign(Object.create(null), value[0]);
      if (type === 11) for (let i = 1; i < value.length; i += 3) field(object[name], key(value[i]), value[i + 2], value[i + 1], depth + 1);
      else for (let i = 0; i < object[name].length; i++) if (value[i + 1]) field(object[name], i, value[0][i], value[i + 1], depth + 1);
    } else throw new Error('界面字段类型不支持。');
  }
  function objectValue(value, depth = 0) {
    if (!Array.isArray(value) || !Array.isArray(masks?.[value[0]])) throw new Error('界面对象无效。');
    const mask = masks[value[0]], definition = classes[mask[0]];
    if (!Array.isArray(definition) || !Array.isArray(definition[1])) throw new Error('界面对象类型无效。');
    const object = Object.assign(Object.create(null), { __type__: definition[0] }), simple = mask.at(-1);
    for (let i = 1; i < value.length; i++) field(object, key(definition[1][mask[i]]), value[i], i < simple ? 0 : definition[mask[i] + definition[2]], depth + 1);
    return object;
  }
  const customCount = Array.isArray(types) ? types.length : 0, marker = raw.at(-1), hasMarker = typeof marker === 'number';
  const normalCount = raw.length - customCount - Number(hasMarker);
  for (let i = 0; i < normalCount; i++) instances[i] = objectValue(raw[i]);
  for (let i = 0; i < customCount; i++) {
    const index = normalCount + i, type = types[i];
    if (type >= 0) instances[index] = custom(classes[type], raw[index]);
    else field(instances, index, raw[index], ~type, 0);
  }
  const refCount = refs.length - 1, objectRefCount = refs.length ? refs[refCount] * 3 : 0;
  if (refCount > 0 && (refCount % 3 || !Number.isSafeInteger(objectRefCount) || objectRefCount < 0 || objectRefCount > refCount)) throw new Error('界面对象引用无效。');
  for (let i = 0; i < refCount; i += 3) {
    const object = i < objectRefCount ? refs[i] : instances[refs[i]], property = refs[i + 1], target = instances[refs[i + 2]];
    if (!object || !target) throw new Error('界面对象引用缺失。');
    object[key(property >= 0 ? strings[property] : ~property)] = target;
  }
  for (let i = 0; i < dependencies.length; i++) {
    const object = typeof dependencies[i] === 'number' ? instances[dependencies[i]] : dependencies[i], property = depKeys[i];
    if (!object) throw new Error('界面素材引用缺失。');
    object[key(property >= 0 ? strings[property] : ~property)] = { __uuid__: decodeUuid(uuids[depIds[i]]) };
  }
  return instances[hasMarker ? marker < 0 ? ~marker : marker : 0];
}
export { decodeUuid, unpackAsset };
