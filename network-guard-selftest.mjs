import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = mkdtempSync(resolve(tmpdir(), 'helix-guard-owned-'));
const outside = mkdtempSync(resolve(tmpdir(), 'helix-guard-unowned-'));
const dir = fileURLToPath(new URL('.', import.meta.url));
process.env.HELIX_QUALIFICATION_UNIX_ROOTS = JSON.stringify([root]);
try {
  await import('./selftest-transport-stub.mjs');
  await import('./network-guard.mjs');
  const calls = globalThis[Symbol.for('helix.qualification.transport-calls')];
  for (const host of ['203.0.113.1', 'example.com', 'localhost.evil', '127.evil.test']) {
    for (const connect of [opts => new net.Socket().connect(opts), opts => net.connect(opts), opts => net.createConnection(opts)]) {
      assert.throws(() => connect({ port: 443, host }), /denies/);
    }
  }
  assert.equal(calls.length, 0);
  assert.throws(() => new net.Socket().connect(443, 'example.com'), /denies/);
  assert.throws(() => new net.Socket().connect([{ port: 443, host: 'example.com' }]), /denies/);
  assert.throws(() => net.connect({ port: 443, host: 'localhost', lookup() {} }), /denies/);
  assert.throws(() => net.connect(resolve(outside, 'socket')), /denies/);
  symlinkSync(outside, resolve(root, 'escape'));
  assert.throws(() => net.connect(resolve(root, 'escape/socket')), /denies/);
  for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '::1', '[::1]']) net.connect({ host, port: 1 }).destroy();
  mkdirSync(resolve(root, 'nested'));
  net.connect(resolve(root, 'nested/owned.sock')).destroy();
  net.createConnection({ path: resolve(root, 'owned.sock') }).destroy();
  net.connect({ host: 'localhost', port: 1, path: '/http/url' }).destroy();
  assert.throws(() => net.connect({ host: 'example.com', port: 443, path: resolve(root, 'owned.sock') }), /denies/);
  assert.equal(calls.length, 8);
  const code = `const assert=require('node:assert/strict');const net=require('node:net');assert.equal(globalThis[Symbol.for('helix.qualification.network-guard')],true);assert.throws(()=>net.connect({host:'example.com',port:443}),/denies/);assert.equal(globalThis[Symbol.for('helix.qualification.transport-calls')].length,0);console.log('Child guard propagation PASS; no connection');`;
  const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env,
    NODE_OPTIONS: '--import ' + resolve(dir, 'selftest-transport-stub.mjs') + ' --import ' + resolve(dir, 'network-guard.mjs') } });
  assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /Child guard propagation PASS/);
  console.log('Guard self-tests PASS: non-loopback denied without connection; owned TCP/Unix allowed; wrappers, symlink escape and child propagation tested.');
} finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
