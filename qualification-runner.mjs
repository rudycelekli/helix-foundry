import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve('candidate'), proof = resolve('proof');
mkdirSync(proof, { recursive: true });
const expected = '8a3185735ed7b7740484fbc0cf262c89a59dfda8';
const tree = '91c28aca2dfcb501722e40510c223e47e254554a';
const base = '00d7927d7c08e16c58316e006959f052427e7fa1';
const before = 'a14bb717273667ac2edae4df5f22af8beedf98ae';
const gitRaw = (...args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git source guard failed');
  return r.stdout;
};
const git = (...args) => gitRaw(...args).trim();
if (git('rev-parse', 'HEAD') !== expected || git('rev-parse', 'HEAD^{tree}') !== tree) throw new Error('wrong candidate');
if (git('merge-base', base, expected) !== base) throw new Error('wrong integrated base');
if (existsSync(resolve(root, '.env'))) throw new Error('qualification cannot use .env');
for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TEST_HELIX', 'TEST_MYSQL', 'TEST_CDC_DATABASES', 'TEST_ONBOARDING_DATABASES', 'ONBOARDING_LOCAL']) {
  if (process.env[key]) throw new Error('unexpected credential or live opt-in environment: ' + key);
}
const hash = (raw) => createHash('sha256').update(raw).digest('hex');
const frozen = JSON.parse(readFileSync(resolve(proof, 'frozen-gitblob-manifest.json')));
const files = Object.keys(frozen.files);
function sourceGuard() {
 const r = spawnSync(process.execPath, [resolve('harness/source-guard.mjs'), 'verify'], { encoding: 'utf8' });
 if (r.status !== 0) throw new Error('frozen Gitblob source guard failed: ' + r.stderr);
}
sourceGuard();
const results = [];
function run(name, command, args, env = {}) {
  const started = Date.now();
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 35 * 60 * 1000,
    maxBuffer: 40 * 1024 * 1024, detached: true, env: { ...process.env, ...env } });
  if (r.error && r.pid) { try { process.kill(-r.pid, 'SIGTERM'); } catch {} }
  writeFileSync(resolve(proof, name + '.log'), (r.stdout || '') + '\n' + (r.stderr || ''));
  const row = { name, command: [command, ...args], status: r.status, signal: r.signal,
    seconds: (Date.now() - started) / 1000, execution_error: r.error?.code || null };
  results.push(row); writeFileSync(resolve(proof, 'results.json'), JSON.stringify(results, null, 2));
  console.log(name, r.status, r.error?.code || ''); return r;
}
const ownedTemp = resolve(proof, 'owned-temp'); mkdirSync(ownedTemp, { recursive: true });
const guardEnv = { TMPDIR: ownedTemp, TMP: ownedTemp, TEMP: ownedTemp, HELIX_QUALIFICATION_UNIX_ROOTS: JSON.stringify([root, proof, ownedTemp]), NODE_OPTIONS: '--import ' + resolve('harness/network-guard.mjs') };
const versions = { node: process.version, pnpm: spawnSync('pnpm', ['--version'], { encoding: 'utf8' }).stdout.trim() };
writeFileSync(resolve(proof, 'versions.json'), JSON.stringify(versions, null, 2));
let beforePlacementValid = false;
const home = resolve(root, 'apps/web/src/areas/workspace/home.tsx'), homeCandidate = readFileSync(home);
try {
  writeFileSync(home, gitRaw('show', before + ':apps/web/src/areas/workspace/home.tsx'));
  const r = run('placement-before', 'pnpm', ['exec', 'playwright', 'test', 'tests/browser/pipeline-cancellation.spec.ts', '-g', 'keeps pipeline job controls on Data instead of Home', '--reporter=json'], { ...guardEnv, PLAYWRIGHT_JSON_OUTPUT_NAME: resolve(proof, 'placement-before.json') });
  const j = JSON.parse(readFileSync(resolve(proof, 'placement-before.json'), 'utf8'));
  const specs = []; const walk = s => { specs.push(...(s.specs || [])); for (const child of s.suites || []) walk(child); };
  for (const suite of j.suites) walk(suite);
  const selected = specs.find(x => x.title === 'keeps pipeline job controls on Data instead of Home');
  const result = selected?.tests?.[0]?.results?.at(-1);
  const error = (result?.errors || [result?.error]).filter(Boolean).map(x => x.message || '').join('\n');
  beforePlacementValid = r.status !== 0 && result?.status === 'failed' && /toHaveCount/.test(error)
    && /Expected:.*0/.test(error) && /Received:.*1/.test(error);
} catch (error) { writeFileSync(resolve(proof, "placement-before-evaluator-error.json"), JSON.stringify({ error: String(error) }));
} finally { writeFileSync(home, homeCandidate); }
sourceGuard();
run('browser', 'pnpm', ['test:browser'], guardEnv);
let unchanged = git('diff', '--name-only').length === 0;
try { sourceGuard(); } catch (error) { unchanged = false; writeFileSync(resolve(proof, 'final-source-guard-error.json'), JSON.stringify({ error: String(error) })); }
for (const name of ['pipeline-cancel-1440.png', 'pipeline-cancel-390.png']) {
  const f = resolve(root, '.data/browser-isolated', name); if (existsSync(f)) copyFileSync(f, resolve(proof, name));
}
const required = results.filter(x => x.name === 'browser');
const pass = beforePlacementValid && unchanged && required.length === 1 && required.every(x => x.status === 0 && !x.execution_error);
writeFileSync(resolve(proof, 'receipt.json'), JSON.stringify({ status: pass ? 'BROWSER_LANE_PASS' : 'FAIL', passed_typecheck_test_build_run: 38427904676, candidate: expected, tree, upstream_base: base,
  original_pr_head: before, before_placement_causal_valid: beforePlacementValid,
  required_gates: required, unchanged_sources: unchanged, source_file_count: files.length, versions,
  controls: 'Actual production source with original single-file overlays, restored before candidate gates; no full-baseline qualification claim.',
  limits: 'Default suite may skip opt-in live integrations; no live provider/model/database claims. Original overlays fail only as validated causal assertions; all required candidate commands must pass.' }, null, 2));
process.exitCode = pass ? 0 : 1;
