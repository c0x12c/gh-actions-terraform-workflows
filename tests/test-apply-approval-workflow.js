#!/usr/bin/env node

/**
 * Tests for the reusable terraform-apply-approval workflow. Checks the invariants that span
 * jobs, and runs the REAL inline shell of the gate's preflight steps against a fake gh, so the
 * failure paths are exercised, not mirrored.
 *
 * Usage: node tests/test-apply-approval-workflow.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WORKFLOW = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'terraform-apply-approval.yml'), 'utf8');

/** The text of one job, from its key to the next top-level job key. */
function job(name) {
  const m = WORKFLOW.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z_]+:\\n|(?![\\s\\S]))`, 'm'));
  assert.ok(m, `job ${name} not found`);
  return m[1];
}

/** The `run: |` block of the named step, dedented. */
function runBlock(stepName) {
  const lines = WORKFLOW.split('\n');
  const start = lines.findIndex(l => l.trim() === `- name: ${stepName}`);
  assert.ok(start >= 0, `step ${stepName} not found`);
  const runIdx = lines.findIndex((l, i) => i > start && l.trim() === 'run: |');
  const indent = lines[runIdx].search(/\S/);
  const body = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() !== '' && lines[i].search(/\S/) <= indent) break;
    body.push(lines[i]);
  }
  const pad = Math.min(...body.filter(l => l.trim()).map(l => l.search(/\S/)));
  return body.map(l => l.slice(pad)).join('\n');
}

/** Run a script with a fake gh on PATH. ghBody is the fake's bash body. */
function runWithFakeGh(script, ghBody, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-'));
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash\n${ghBody}\n`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  let code = 0, out = '';
  try {
    out = execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env }, stdio: 'pipe',
    }).toString();
  } catch (e) { code = e.status; out = `${e.stdout}${e.stderr}`; }
  fs.rmSync(dir, { recursive: true, force: true });
  return { code, out };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✓ PASSED  ${name}`); passed++; }
  catch (e) { console.log(`✗ FAILED  ${name}\n   ${e.message}`); failed++; }
}

console.log('Running apply-approval workflow tests...\n');

test('the notifier polls for the exact title the gate opens', () => {
  const title = job('approval').match(/issue-title: "(.+)"/)[1];
  const polled = job('notify_pending_approval').match(/TITLE: "(.+)"/)[1];
  assert.strictEqual(polled, title);
});

test('the gate cannot mint an OIDC token and runs on a Docker-capable runner', () => {
  const gate = job('approval');
  assert.match(gate, /^    permissions: \{\}$/m);
  assert.match(gate, /^    runs-on: ubuntu-latest$/m);
});

test('apply waits for the gate, and both skip a no-change plan', () => {
  const apply = job('terraform_apply');
  assert.match(apply, /needs: \[terraform_plan, approval\]/);
  assert.match(apply, /if: needs\.terraform_plan\.outputs\.has_changes == 'true'/);
  assert.match(job('approval'), /if: needs\.terraform_plan\.outputs\.has_changes == 'true'/);
});

test('plan and apply check out the run SHA', () => {
  for (const j of ['terraform_plan', 'terraform_apply']) {
    assert.match(job(j), /ref: \$\{\{ github\.sha \}\}/, j);
  }
});

const preflight = runBlock('Verify approver teams resolve');
const teamsEnv = { ORG: 'acme', TEAMS: 'sre, leads' };

test('preflight passes when every team has members', () => {
  const r = runWithFakeGh(preflight, 'echo 3', teamsEnv);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /sre: 3 member/);
  assert.match(r.out, /leads: 3 member/);
});

test('preflight fails on a team with no members, naming it', () => {
  const r = runWithFakeGh(preflight, 'case "$2" in *leads*) echo 0 ;; *) echo 2 ;; esac', teamsEnv);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /'leads' resolved to no members/);
  assert.doesNotMatch(r.out, /'sre' resolved/);
});

test('preflight fails when the API errors, rather than opening the gate', () => {
  const r = runWithFakeGh(preflight, 'echo "HTTP 404" >&2; exit 1', teamsEnv);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /'sre' resolved to no members/);
});

const timeoutCheck = runBlock('Check approval timeout');
for (const [value, ok] of [['45', true], ['55', true], ['56', false], ['0', false]]) {
  test(`timeout ${value} is ${ok ? 'accepted' : 'rejected'}`, () => {
    const r = runWithFakeGh(timeoutCheck, 'exit 0', { TIMEOUT: value });
    assert.strictEqual(r.code === 0, ok, r.out);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
