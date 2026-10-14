import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const pauses = [10, 20, 40, 80, 160, 320, 640];
const sleeper = new Int32Array(new SharedArrayBuffer(4));

/** Windows readers/scanners can briefly deny replacement of a closed file. */
export function renameFileSync(source: string, target: string) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(source, target); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === pauses.length) throw error;
      // Keep the old destination readable throughout the bounded retry. Never
      // unlink it first or truncate it as a fallback to a failed atomic rename.
      Atomics.wait(sleeper, 0, 0, pauses[attempt]);
    }
  }
}

export function writeAtomicFileSync(file: string, data: string | Uint8Array) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Separate processes must not overwrite or rename each other's staging file.
  const temporary = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx' });
    renameFileSync(temporary, file);
  } finally { try { fs.unlinkSync(temporary); } catch { /* Missing or still held by a scanner. */ } }
}
