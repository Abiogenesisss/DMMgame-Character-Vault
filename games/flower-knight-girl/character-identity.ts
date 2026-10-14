'use strict';
const { isMaterialId } = require('./character-types.ts');

// Asset families share the last five digits; evolution aliases come from the
// catalog. Do not pair arbitrary numeric IDs without a known before form.
function baseId(value, catalog?: any) {
  const id = String(value ?? '');
  if (!/^[1245]\d{5}(?:\d{3})?$/.test(id) || isMaterialId(id)) return null;
  const stem = '1' + id.slice(1, 6);
  return catalog?.aliases?.[id] || catalog?.aliases?.[stem] || stem;
}

function characterAliases(characters) {
  const aliases = {};
  for (const character of characters) {
    for (const id of [character.id, ...(character.variants || []), ...Object.values<any>(character.forms || {})]) {
      aliases[String(id)] = character.id;
      const stem = baseId(id);
      if (stem) aliases[stem] = character.id;
    }
  }
  return aliases;
}

export { baseId, characterAliases };
