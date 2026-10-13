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
  assert.throws(() => net.connect({ port: 443, host: 'example.com', lookup() { throw new Error('must not run'); } }), /denies/);
  assert.throws(() => net.connect(resolve(outside, 'socket')), /denies/);
  symlinkSync(outside, resolve(root, 'escape'));
  assert.throws(() => net.connect(resolve(root, 'escape/socket')), /denies/);
  for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '::1', '[::1]']) net.connect({ host, port: 1 }).destroy();
  mkdirSync(resolve(root, 'nested'));
  net.connect(resolve(root, 'nested/owned.sock')).destroy();
  net.createConnection({ path: resolve(root, 'owned.sock') }).destroy();
  net.connect({ host: 'localhost', port: 1, path: null }).destroy();
  assert.throws(() => net.connect({ host: 'localhost', port: 1, path: resolve(outside, 'socket') }), /denies/);
  assert.throws(() => net.connect({ host: 'localhost', port: 1, path: '/http/url' }), /denies/);
  assert.throws(() => net.connect({ host: 'example.com', port: 443, path: resolve(root, 'owned.sock') }), /denies/);
  assert.equal(calls.length, 8);
  const checkLookup = (lookup, expected, options = {}) => {
    const count = calls.length;
    net.connect({ host: 'localhost', port: 1, lookup }).destroy();
    const call = calls.at(-1); const guarded = (Array.isArray(call[0]) ? call[0][0] : call[0]).lookup;
    let observed;
    guarded('localhost', options, (...values) => { observed = values; });
    assert.equal(calls.length, count + 1);
    assert.equal(Boolean(observed?.[0]), expected === 'error');
    return observed;
  };
  assert.deepEqual(checkLookup((_h, _o, cb) => cb(null, '127.0.0.1', 4), 'ok'), [null, '127.0.0.1', 4]);
  assert.deepEqual(checkLookup((_h, _o, cb) => cb(null, [{ address: '::1', family: 6 }, { address: '127.0.0.2', family: 4 }]), 'ok', { all: true })[1], [{ address: '::1', family: 6 }, { address: '127.0.0.2', family: 4 }]);
  for (const address of ['203.0.113.1', 'localhost', 'example.com']) checkLookup((_h, _o, cb) => cb(null, address, 4), 'error');
  checkLookup((_h, _o, cb) => cb(null, '127.0.0.1', 6), 'error');
  checkLookup((_h, _o, cb) => cb(null, [{ address: '::1', family: 6 }, { address: '203.0.113.1', family: 4 }]), 'error', { all: true });
  checkLookup((_h, _o, cb) => cb(null, []), 'error', { all: true });
  const lookupError = new Error('owned DNS error');
  assert.equal(checkLookup((_h, _o, cb) => cb(lookupError), 'error')[0], lookupError);
  net.connect({ host: 'localhost', port: 1, lookup: (_h, _o, cb) => cb(null, '127.0.0.1', 4) }).destroy();
  const throwingCall = calls.at(-1), throwingLookup = (Array.isArray(throwingCall[0]) ? throwingCall[0][0] : throwingCall[0]).lookup;
  const callbackError = new Error('callback must propagate');
  assert.throws(() => throwingLookup('localhost', {}, () => { throw callbackError; }), error => error === callbackError);
  const code = `const assert=require('node:assert/strict');const net=require('node:net');assert.equal(globalThis[Symbol.for('helix.qualification.network-guard')],true);assert.throws(()=>net.connect({host:'example.com',port:443}),/denies/);assert.equal(globalThis[Symbol.for('helix.qualification.transport-calls')].length,0);console.log('Child guard propagation PASS; no connection');`;
  const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env,
    NODE_OPTIONS: '--import ' + resolve(dir, 'selftest-transport-stub.mjs') + ' --import ' + resolve(dir, 'network-guard.mjs') } });
  assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /Child guard propagation PASS/);
  console.log('Guard self-tests PASS: non-loopback denied without connection; owned TCP/Unix allowed; wrappers, symlink escape and child propagation tested.');
} finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
