#!/usr/bin/env node

/**
 * Tests for the terraform-plan failure gate. Runs the REAL scripts/plan.sh against a fake
 * terraform, so the exit-code capture and cleanup are exercised, not mirrored.
 *
 * Usage: node tests/test-plan-gate.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PLAN_SH = path.join(ROOT, 'actions', 'terraform-plan', 'scripts', 'plan.sh');
const ACTION = path.join(ROOT, 'actions', 'terraform-plan', 'action.yml');

/** Run plan.sh with a fake terraform whose plan/show exit with the given codes. */
function runPlan(planCode, showCode = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gate-'));
  fs.writeFileSync(path.join(dir, 'terraform'), `#!/usr/bin/env bash
case "$1" in
  plan) [ "${planCode}" -eq 0 ] && { echo "Plan: 1 to add"; : > /tmp/plan.tmp; } || echo "Error: broke" >&2; exit ${planCode} ;;
  show) [ "${showCode}" -eq 0 ] && echo "rendered plan" || { echo "show failed" >&2; exit ${showCode}; }; exit 0 ;;
esac
exit 0
`);
  fs.chmodSync(path.join(dir, 'terraform'), 0o755);
  const outFile = path.join(dir, 'gh_output');
  fs.writeFileSync(outFile, '');
  for (const f of ['/tmp/plan.tmp', '/tmp/plan.raw', '/tmp/plan.out']) fs.rmSync(f, { force: true });

  let stepFailed = false;
  try {
    execFileSync('bash', [PLAN_SH], {
      cwd: dir,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: outFile, REFRESH: 'true' },
      stdio: 'pipe',
    });
  } catch { stepFailed = true; }

  const m = fs.readFileSync(outFile, 'utf8').match(/plan_exitcode=(\d+)/);
  const planOut = fs.existsSync('/tmp/plan.out') ? fs.readFileSync('/tmp/plan.out', 'utf8') : null;
  const tmpLeaked = fs.existsSync('/tmp/plan.tmp') || fs.existsSync('/tmp/plan.raw');
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of ['/tmp/plan.tmp', '/tmp/plan.raw', '/tmp/plan.out']) fs.rmSync(f, { force: true });
  return { plan_exitcode: m ? m[1] : null, planOut, stepFailed, tmpLeaked };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✓ PASSED  ${name}`); passed++; }
  catch (e) { console.log(`✗ FAILED  ${name}\n   ${e.message}`); failed++; }
}

console.log('Running plan-gate tests...\n');

test('gate keys off the step outcome, and comment skips a pre-plan failure', () => {
  const a = fs.readFileSync(ACTION, 'utf8');
  assert.ok(/if:\s*steps\.plan\.outcome\s*==\s*'failure'/.test(a), 'gate must be steps.plan.outcome == failure');
  assert.ok(/steps\.plan\.outcome\s*!=\s*'skipped'/.test(a), 'comment step must skip a pre-plan failure');
});

test('a successful plan records exit 0, renders via show, no leak', () => {
  const r = runPlan(0);
  assert.strictEqual(r.plan_exitcode, '0');
  assert.ok(!r.stepFailed, 'clean plan+show should not fail the step');
  assert.ok(r.planOut && r.planOut.includes('rendered plan'), 'plan.out holds the show render');
  assert.ok(!r.tmpLeaked, 'plan.tmp/plan.raw cleaned');
});

test('a failed plan records its own exit code and preserves output, no leak', () => {
  const r = runPlan(1);
  assert.strictEqual(r.plan_exitcode, '1', 'captures the plan exit code');
  assert.ok(r.stepFailed, 'a failed plan fails the step');
  assert.ok(r.planOut && r.planOut.includes('broke'), 'failure output preserved for the comment');
  assert.ok(!r.tmpLeaked, 'temp files cleaned on the failure path');
});

test('a show failure after a clean plan fails the step (caught by the outcome gate), no leak', () => {
  const r = runPlan(0, 1);
  assert.strictEqual(r.plan_exitcode, '0', 'the plan itself succeeded');
  assert.ok(r.stepFailed, 'a failing show must fail the step');
  assert.ok(!r.tmpLeaked, 'temp files cleaned even on early abort');
});

console.log('\n' + '='.repeat(50));
console.log(`Passed: ${passed}\nFailed: ${failed}`);
console.log('='.repeat(50));
if (failed > 0) process.exit(1);
