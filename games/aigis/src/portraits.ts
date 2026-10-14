'use strict';
// PromotionCard is not part of the in-game portrait set. Check both catalogue
// names and older exported-image metadata so stale entries cannot return.
function isGamePortrait(item) {
  return item.phase !== 'promotion' && item.label !== '升格立绘'
    && !/^PromotionCard\d+\.aar$/i.test(item.name || item.resource || '');
}
export { isGamePortrait };
