import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve('candidate'), proof = resolve('proof');
const expected = '8a3185735ed7b7740484fbc0cf262c89a59dfda8';
const tree = '91c28aca2dfcb501722e40510c223e47e254554a';
function git(...args) { const r = spawnSync('git', args, { cwd: root }); if (r.status) throw new Error('source Git guard failed'); return r.stdout; }
const hash = raw => createHash('sha256').update(raw).digest('hex');
if (git('rev-parse', 'HEAD').toString().trim() !== expected || git('rev-parse', 'HEAD^{tree}').toString().trim() !== tree) throw new Error('wrong candidate');
const manifestPath = resolve(proof, 'frozen-gitblob-manifest.json');
let manifest;
if (process.argv[2] === 'create') {
  mkdirSync(proof, { recursive: true });
  const entries = git('ls-tree', '-r', '-z', expected).toString().split('\0').filter(Boolean);
  manifest = { head: expected, tree, files: {} };
  for (const entry of entries) {
    const tab = entry.indexOf('\t'), [mode, kind, oid] = entry.slice(0, tab).split(' '), path = entry.slice(tab + 1);
    if (kind !== 'blob') throw new Error('unsupported non-blob entry');
    const raw = git('cat-file', 'blob', oid);
    manifest.files[path] = { mode, git_oid: oid, sha256: hash(raw), bytes: raw.length };
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
} else { manifest = JSON.parse(readFileSync(manifestPath)); }
if (manifest.head !== expected || manifest.tree !== tree) throw new Error('wrong frozen manifest');
for (const [path, entry] of Object.entries(manifest.files)) {
  const file = resolve(root, path), stat = lstatSync(file);
  const raw = entry.mode === '120000' ? Buffer.from(readlinkSync(file)) : readFileSync(file);
  if ((entry.mode === '120000') !== stat.isSymbolicLink() || hash(raw) !== entry.sha256 || raw.length !== entry.bytes) throw new Error('tracked source changed: ' + path);
}
if (git('diff', 'HEAD', '--name-only').toString().trim()) throw new Error('tracked tree changed');
console.log('Frozen Gitblob source guard PASS', Object.keys(manifest.files).length, expected);
