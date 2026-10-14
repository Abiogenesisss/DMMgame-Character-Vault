'use strict';
function canonicalId(id) {
  const value = String(id ?? '');
  if (/^\d{1,6}$/.test(value) && Number(value) > 0) return String(Number(value)).padStart(4, '0');
  const match = /^(skin|event)-(\d{4,6})$/.exec(value);
  return match && Number(match[2]) > 0 ? value : null;
}
export { canonicalId };
