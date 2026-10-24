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

test('the notifier and the close step look for the exact title the gate opens', () => {
  const title = job('approval').match(/issue-title: "(.+)"/)[1];
  assert.match(title, /github\.run_id.*github\.run_attempt/, 'an older attempt\'s issue must not match');
  assert.strictEqual(job('notify_pending_approval').match(/TITLE: "(.+)"/)[1], title);
  assert.strictEqual(job('approval').match(/TITLE: "(.+)"/)[1], title);
});

test('a "No changes." plan, as terraform prints it, skips the gate', () => {
  const plan = job('terraform_plan');
  assert.match(plan, /has_changes: \$\{\{ !startsWith\(steps\.plan\.outputs\.plan_counts, 'No changes\.'\) \}\}/);
  assert.doesNotMatch(plan, /plan_counts [!=]= 'No changes\.'/);
});

test('apply refuses a re-plan that differs from the approved one', () => {
  const apply = job('terraform_apply');
  assert.match(apply, /APPROVED: \$\{\{ needs\.terraform_plan\.outputs\.plan_counts \}\}/);
  assert.match(apply, /CURRENT: \$\{\{ steps\.replan\.outputs\.plan_counts \}\}/);
  assert.ok(apply.indexOf('id: replan') < apply.indexOf('id: apply'), 're-plan must run before apply');
  const check = runBlock('Check the plan matches the approved one');
  const approved = 'Plan: 1 to add, 0 to change, 0 to destroy.';
  assert.strictEqual(runWithFakeGh(check, 'exit 0', { APPROVED: approved, CURRENT: approved }).code, 0);
  const r = runWithFakeGh(check, 'exit 0',
    { APPROVED: approved, CURRENT: 'Plan: 1 to add, 0 to change, 1 to destroy.' });
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /plan changed since approval/);
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
const teamsEnv = { ORG: 'acme', TEAMS: 'sre, leads', ACTOR: 'release-bot[bot]' };

test('preflight passes when every team has members', () => {
  const r = runWithFakeGh(preflight, 'printf "alice\\nbob\\ncarol\\n"', teamsEnv);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /sre: 3 member/);
  assert.match(r.out, /leads: 3 member/);
});

test('preflight paginates, so a team past 30 members is counted in full', () => {
  const r = runWithFakeGh(preflight,
    '[[ " $* " == *" --paginate "* ]] && seq -f "user%g" 45 || seq -f "user%g" 30', teamsEnv);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /sre: 45 member/);
});

test('preflight fails on a team with no members, naming it', () => {
  const r = runWithFakeGh(preflight, 'case "$*" in *leads*) ;; *) echo alice ;; esac', teamsEnv);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /'leads' resolved to no members/);
  assert.doesNotMatch(r.out, /'sre' resolved/);
});

test('preflight fails when the only approver is the initiator the action excludes', () => {
  const r = runWithFakeGh(preflight, 'echo Alice', { ...teamsEnv, ACTOR: 'alice' });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /No approver left once the initiator 'alice' is excluded/);
});

test('preflight passes when someone besides the initiator can approve', () => {
  const r = runWithFakeGh(preflight, 'printf "alice\\nbob\\n"', { ...teamsEnv, ACTOR: 'alice' });
  assert.strictEqual(r.code, 0, r.out);
});

test('preflight fails when the API errors, rather than opening the gate', () => {
  const r = runWithFakeGh(preflight, 'echo "HTTP 404" >&2; exit 1', teamsEnv);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /'sre' resolved to no members/);
});

const timeoutCheck = runBlock('Check approval timeout');
for (const [value, ok] of [
  ['45', true], ['55', true], ['56', false], ['0', false], ['60.5', false], ['30.5', false], ['', false],
]) {
  test(`timeout '${value}' is ${ok ? 'accepted' : 'rejected'}`, () => {
    const r = runWithFakeGh(timeoutCheck, 'exit 0', { TIMEOUT: value });
    assert.strictEqual(r.code === 0, ok, r.out);
  });
}

const closeIssue = runBlock('Close approval issue');
const closeEnv = { REPO: 'acme/infra', TITLE: 'Approve prod terraform apply - v1 (run 9-1)' };
// Logs each call, and answers the issue search with #42.
const closeGh = 'echo "$*" >> "$GH_LOG"; [[ "$*" == *"--jq"* ]] && echo 42; exit 0';

test('close falls back to the title when the killed step left no issue-number', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'close-')), 'log');
  const r = runWithFakeGh(closeIssue, closeGh, { ...closeEnv, ISSUE_NUMBER: '', GH_LOG: log });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(fs.readFileSync(log, 'utf8'), /-X PATCH --silent repos\/acme\/infra\/issues\/42 -f state=closed/);
});

test('close uses issue-number directly when present', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'close-')), 'log');
  const r = runWithFakeGh(closeIssue, closeGh, { ...closeEnv, ISSUE_NUMBER: '7', GH_LOG: log });
  assert.strictEqual(r.code, 0, r.out);
  const calls = fs.readFileSync(log, 'utf8');
  assert.doesNotMatch(calls, /--jq/);
  assert.match(calls, /issues\/7 -f state=closed/);
});

test('close is a no-op when no open issue matches', () => {
  const r = runWithFakeGh(closeIssue, 'exit 0', { ...closeEnv, ISSUE_NUMBER: '' });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /No open approval issue to close/);
});

test('apply-blocked notice fires on anything but a failed apply', () => {
  const m = WORKFLOW.match(/- name: Send Notification to Slack on apply blocked\n[\s\S]*?\n\s+if: (.*)\n/);
  assert.ok(m, 'step not found');
  assert.ok(m[1].includes("steps.apply.conclusion != 'failure'"), m[1]);
  assert.ok(!m[1].includes("== 'skipped'"), m[1]);
});

test('every plan and apply action ref is v3.5.0', () => {
  const refs = WORKFLOW.match(/actions\/terraform-(plan|apply)@\S+/g) || [];
  assert.strictEqual(refs.length, 3, refs.join(' '));
  for (const r of refs) assert.ok(r.endsWith('@v3.5.0'), r);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
