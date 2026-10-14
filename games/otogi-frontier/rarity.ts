'use strict';
// Browser-safe configuration: evolution stages are independent of star rarity.
const RARITIES = [5, 4, 3, 2, 1].map(id => ({ id, label: '★' + id }));
export { RARITIES };
