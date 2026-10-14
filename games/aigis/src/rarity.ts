'use strict';
const { canonicalId } = require('./character-identity.ts');
const RARITIES = [{ id: 5, label: '黑' }, { id: 4, label: '白金' }, { id: 7, label: '蓝宝石' }, { id: 3, label: '金' }, { id: 2, label: '银' }, { id: 1, label: '铜' }, { id: 0, label: '铁' }];
function attachRarities(catalog, units) {
  const byId = new Map<any, any>(units.filter(unit => Number.isInteger(unit.id) && typeof unit.name === 'string' && Number.isInteger(unit.rarity_id)).map(unit => [canonicalId(unit.id), unit]));
  for (const character of catalog.characters) {
    const unit = byId.get(character.id);
    // Check both ID and the name from the game's own name table. Unmatched
    // entries (including independently numbered skins/events) remain unknown.
    const code = unit?.name === character.name ? unit.rarity_id : null;
    const id = code === 10 ? 4 : code === 11 ? 5 : code;
    const rarity = RARITIES.find(rarity => rarity.id === id);
    character.rarityId = rarity?.id ?? null; character.rarityLabel = rarity?.label || '未标注';
    character.rarityCode = rarity ? code : null;
  }
  return catalog;
}
export { RARITIES, attachRarities };
