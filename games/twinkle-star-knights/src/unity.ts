import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
export function runUnity(request: unknown): Promise<any> {
  const python = process.env.TWINKLE_PYTHON || process.env.VAULT_PYTHON || path.resolve(__dirname, '../../../.tools/python/twinkle-star-knights', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) throw new Error('请运行 npm run setup:python -- twinkle-star-knights 安装闪耀星骑士依赖。');
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-X', 'utf8', path.join(__dirname, '../python/export_unity.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '', overflow = false;
    child.stdout.on('data', data => { output += data; if (output.length > 16 * 1024 ** 2) { overflow = true; child.kill(); } });
    child.stderr.on('data', data => { error = (error + data).slice(-3000); }); child.on('error', reject);
    child.on('exit', code => { if (code || overflow) reject(new Error(error || 'Unity 解析失败。')); else { try { resolve(JSON.parse(output)); } catch { reject(new Error('Unity 输出格式无效。')); } } });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(request));
  });
}
