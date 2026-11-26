import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the site stops cleanly on SIGTERM, the way Railway ends an old deploy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-shutdown-'));
  const child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    env: { PATH: process.env.PATH, PORT: '0', STUDIO_DB_PATH: path.join(dir, 'studio.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const waitFor = (pattern) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}: ${output}`)), 10000);
    const check = () => { if (pattern.test(output)) { clearTimeout(timer); resolve(); } else setTimeout(check, 25); };
    check();
  });
  await waitFor(/Studio database ready/);
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  const { code, signal } = await exited;
  assert.equal(signal, null, output);
  assert.equal(code, 0, output);
  assert.match(output, /SIGTERM received, stopping[\s\S]*Stopped/);
});

test('Railway starts the server with node directly, so signals reach it', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'railway.json'), 'utf8'));
  assert.equal(config.deploy.startCommand, 'node server.js');
  assert.equal(config.deploy.healthcheckPath, '/health');
});
