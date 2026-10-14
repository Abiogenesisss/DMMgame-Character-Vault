'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
function pythonPath() {
  const executable = process.env.OTOGI_PYTHON || process.env.VAULT_PYTHON || path.resolve(__dirname, '../../../.tools/python/otogi-frontier', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(executable)) throw new Error('请运行 install-python.cmd，为童话边境安装 Python 依赖。');
  return executable;
}
function runPython(script, args = [], input) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath(), ['-X', 'utf8', path.resolve(__dirname, '../python', script), ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', data => { output += data; if (output.length > 16 * 1024 * 1024) { child.kill(); reject(new Error('解包输出超过大小限制。')); } });
    child.stderr.on('data', data => { error = (error + data).slice(-3000); });
    child.on('error', reject); child.on('exit', code => {
      if (code) reject(new Error(error || '童话边境资源解析失败。'));
      else try { resolve(JSON.parse(output)); } catch { reject(new Error('童话边境资源解析结果无效。')); }
    });
    child.stdin.end(input == null ? '' : JSON.stringify(input));
  });
}
export { pythonPath, runPython };
