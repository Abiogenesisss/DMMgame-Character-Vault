'use strict';
const RARITIES = [{ id: 6, label: '★6' }, { id: 5, label: '★5' }, { id: 4, label: '★4' }, { id: 3, label: '★3' }, { id: 2, label: '★2' }];
// The 099xx unit family contains strengthening/evolution materials. Its
// captured avatars are not playable flower knights, even though IDs start at 1.
const isMaterialId = value => /^[1245]099\d{2}(?:\d{3})?$/.test(String(value));
export { RARITIES, isMaterialId };
