'use strict';
const validId = value => /^\d{4,8}$/.test(String(value));
function canonicalId(value, catalog) { const id = String(value ?? ''); return validId(id) ? catalog?.aliases?.[id] || id : null; }
export { canonicalId };
