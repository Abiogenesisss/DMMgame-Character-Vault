'use strict';
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const characterArtists = character => [...new Set<string>((Array.isArray(character.artists) ? character.artists : []).filter(name => typeof name === 'string' && name.trim()))];
function matchesArtist(character, value = 'all') {
  const artists = characterArtists(character);
  return value === 'all' || (value === 'unknown' ? !artists.length : value.startsWith('artist:') && artists.includes(value.slice(7)));
}
function artistOptions(characters) {
  const counts = new Map(); let unknown = 0;
  for (const character of characters) { const names = characterArtists(character); if (!names.length) unknown++; for (const name of names) counts.set(name, (counts.get(name) || 0) + 1); }
  return [{ value: 'all', label: '全部画师', count: characters.length }, ...[...counts].sort(([a], [b]) => collator.compare(a, b))
    .map(([name, count]) => ({ value: 'artist:' + name, label: name, count })), { value: 'unknown', label: '未标注', count: unknown }];
}
export { characterArtists, matchesArtist, artistOptions };
