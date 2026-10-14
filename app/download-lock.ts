'use strict';
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
function busy(file) {
  if (!fs.existsSync(file)) return false;
  let owner;
  try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return true; }
  if (!Number.isInteger(owner.pid) || owner.pid <= 0) return true;
  try { process.kill(owner.pid, 0); return true; }
  catch (error) {
    if (error.code !== 'ESRCH') return true;
    try { fs.unlinkSync(file); } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
    return false;
  }
}
function acquire(file) {
  if (busy(file)) return null;
  const token = randomUUID();
  try {
    const descriptor = fs.openSync(file, 'wx');
    try { fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token })); }
    finally { fs.closeSync(descriptor); }
    return token;
  } catch (error) { if (error.code === 'EEXIST') return null; throw error; }
}
function release(file, token) {
  if (!fs.existsSync(file)) return;
  const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (owner.pid === process.pid && owner.token === token) fs.unlinkSync(file);
}
export { busy, acquire, release };
