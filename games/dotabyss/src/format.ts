'use strict';
const ORIGIN = 'https://api.abyss-prod-r18.dotabyss.dmmgames.com';
const validId = value => typeof value === 'string' && /^1\d{8}$/.test(value);
function resourceKind(value) {
  let url; try { url = new URL(value); } catch { return null; }
  if (url.origin !== ORIGIN || url.username || url.password || url.hash) return null;
  if (!/^\/resources\/webgl\/r18\/aas\/\d+\/aa\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(bundle|bin|hash)$/.test(url.pathname)) return null;
  return url.pathname.endsWith('.bundle') ? 'bundle' : url.pathname.endsWith('.bin') ? 'catalog' : 'hash';
}
export { ORIGIN, validId, resourceKind };
