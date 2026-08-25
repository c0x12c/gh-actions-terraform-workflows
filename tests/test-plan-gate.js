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
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-temp-'));
  const tmpFile = f => path.join(runnerTemp, f);
  fs.writeFileSync(path.join(dir, 'terraform'), `#!/usr/bin/env bash
case "$1" in
  plan) [ "${planCode}" -eq 0 ] && { echo "Plan: 1 to add"; : > "$RUNNER_TEMP/plan.tmp"; } || echo "Error: broke" >&2; exit ${planCode} ;;
  show) [ "${showCode}" -eq 0 ] && echo "rendered plan" || { echo "show failed" >&2; exit ${showCode}; }; exit 0 ;;
esac
exit 0
`);
  fs.chmodSync(path.join(dir, 'terraform'), 0o755);
  const outFile = path.join(dir, 'gh_output');
  fs.writeFileSync(outFile, '');
  let stepFailed = false;
  try {
    execFileSync('bash', [PLAN_SH], {
      cwd: dir,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: outFile, REFRESH: 'true', RUNNER_TEMP: runnerTemp },
      stdio: 'pipe',
    });
  } catch { stepFailed = true; }

  const m = fs.readFileSync(outFile, 'utf8').match(/plan_exitcode=(\d+)/);
  const planOut = fs.existsSync(tmpFile('plan.out')) ? fs.readFileSync(tmpFile('plan.out'), 'utf8') : null;
  // The old fixed paths are checked too, so a regression back to them still reads as a leak.
  const tmpLeaked = ['plan.tmp', 'plan.raw'].some(f => fs.existsSync(tmpFile(f)) || fs.existsSync(`/tmp/${f}`));
  const planOutMode = fs.existsSync(tmpFile('plan.out'))
    ? (fs.statSync(tmpFile('plan.out')).mode & 0o777).toString(8) : null;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(runnerTemp, { recursive: true, force: true });
  return { plan_exitcode: m ? m[1] : null, planOut, stepFailed, tmpLeaked, planOutMode };
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

// The rendered plan carries resource attributes and is not secret-masked, so a fixed path both
// collides between concurrent jobs on a self-hosted runner and exposes it to other users there.
test('plan artifacts live in RUNNER_TEMP, 0600, not a shared /tmp', () => {
  const sources = ['actions/terraform-plan/scripts/plan.sh',
                   'scripts/post-comment.js',
                   'scripts/validate.sh',
                   'scripts/gcp-plan.sh',
                   'actions/terraform-plan/action.yml',
                   'actions/terraform-plan-gcp/action.yml',
                   'actions/terraform-apply-gcp/action.yml'];
  for (const f of sources) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /\/tmp\/(plan|validate)/, `${f} still has a fixed /tmp path`);
    // Unguarded ${RUNNER_TEMP} would write to /validate_output.txt off a runner, where the
    // scripts are otherwise runnable - as the tests themselves rely on.
    assert.doesNotMatch(src, /\$\{RUNNER_TEMP\}/, `${f} uses RUNNER_TEMP without a /tmp fallback`);
    // TMP is defined inside the scripts; a step referencing it in YAML has nothing to expand and
    // would write to the filesystem root.
    if (f.endsWith('.yml')) assert.doesNotMatch(src, /\$\{TMP\}/, `${f} expands TMP outside a script`);
  }
  assert.strictEqual(runPlan(0).planOutMode, '600', 'the rendered plan must not be world-readable');
});

test('plan.sh captures terraform own exit code via PIPESTATUS, not the pipeline/tee status', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'actions', 'terraform-plan', 'scripts', 'plan.sh'), 'utf8');
  assert.ok(/plan_code=\$\{PIPESTATUS\[0\]\}/.test(sh), 'must read PIPESTATUS[0] so tee cannot mask the plan code');
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
  assert.ok(r.planOut && r.planOut.includes('show failed'), 'show stderr appended to plan.out on failure');
  assert.ok(!r.tmpLeaked, 'temp files cleaned even on early abort');
});

console.log('\n' + '='.repeat(50));
console.log(`Passed: ${passed}\nFailed: ${failed}`);
console.log('='.repeat(50));
if (failed > 0) process.exit(1);
