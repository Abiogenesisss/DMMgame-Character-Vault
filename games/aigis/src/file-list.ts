// Shared with the Aigis HAR picker. This module only reads data and has no I/O.
const BASE = 'https://drc1bk94f7rq8.cloudfront.net/';
const FILE_LIST_NAME = '1fp32igvpoxnb521p9dqypak5cal0xv0';
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
function parseFileList(input: string | Uint8Array) {
  let text: string;
  if (typeof input === 'string') text = input;
  else for (let key = 0; key < 256; key++) {
    const prefix = input.slice(0, 256).map(byte => byte ^ key);
    if (!/[a-f0-9]{40},[a-z0-9]{32},\d,\d{12},/.test(new TextDecoder().decode(prefix))) continue;
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.map(byte => byte ^ key)); break;
  }
  if (!text) throw new Error('无法识别千年战争资源清单。');
  const entries = text.trim().split(/\r?\n/).map(line => {
    const match = /^([a-f0-9]{40}),([a-z0-9]{32}),\d,(\d{12}),([A-Za-z0-9_.-]+)$/.exec(line);
    if (!match || match[4] === '..') throw new Error('千年战争资源清单包含无效记录。');
    return { name: match[4], url: BASE + match[1] + '/' + match[2], size: Number(match[3]) };
  });
  return { text, entries };
}
export { BASE, FILE_LIST_NAME, MAX_CATALOG_BYTES, parseFileList };
