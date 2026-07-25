#!/usr/bin/env node

/**
 * Unit test for the terraform-plan failure gate.
 *
 * Extracts and executes the real "Terraform Plan" step script from
 * actions/terraform-plan/action.yml with a fake `terraform` on PATH, so the test verifies
 * the action's actual exit-code capture rather than a mirror of it. The gate must record
 * the plan's OWN exit code (not the trailing `terraform show`'s) so a failed plan is caught.
 *
 * Usage: node tests/test-plan-gate.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ACTION = path.join(__dirname, '..', 'actions', 'terraform-plan', 'action.yml');

/** Extract a named step's `run: |` block from the action, dedented as the runner would. */
function extractRunBlock(stepName) {
  const lines = fs.readFileSync(ACTION, 'utf8').split('\n');
  const nameIdx = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  assert.ok(nameIdx !== -1, `step "${stepName}" not found`);
  const runIdx = lines.findIndex((l, i) => i > nameIdx && l.trim() === 'run: |');
  assert.ok(runIdx !== -1, `run block for "${stepName}" not found`);

  const body = [];
  const indent = lines[runIdx].search(/\S/) + 2;
  for (const line of lines.slice(runIdx + 1)) {
    if (line.trim() !== '' && line.search(/\S/) < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

/**
 * Run the plan step with a fake terraform whose `plan` exits `planCode` and `show` exits
 * `showCode`. The script runs under the SAME shell flags GitHub Actions uses for a bash
 * step (`-e -o pipefail`), so shell-behavior regressions (e.g. a failing `show` aborting
 * the step) are exercised the way the runner would see them.
 */
function runPlanStep(planCode, showCode = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gate-'));
  const bin = path.join(dir, 'terraform');
  fs.writeFileSync(bin, `#!/usr/bin/env bash
cmd="$1"
if [ "$cmd" = "plan" ]; then
  if [ "${planCode}" -eq 0 ]; then
    echo "Plan: 1 to add, 0 to change, 0 to destroy."
    : > /tmp/plan.tmp
  else
    echo "Error: something broke" >&2
  fi
  exit ${planCode}
elif [ "$cmd" = "show" ]; then
  if [ "${showCode}" -eq 0 ]; then echo "rendered plan from show"; else echo "show failed" >&2; fi
  exit ${showCode}
fi
exit 0
`);
  fs.chmodSync(bin, 0o755);

  const outFile = path.join(dir, 'gh_output');
  fs.writeFileSync(outFile, '');
  const script = extractRunBlock('Terraform Plan').replace(/\$\{\{ inputs\.refresh \}\}/g, 'true');

  for (const f of ['/tmp/plan.tmp', '/tmp/plan.raw', '/tmp/plan.out']) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }

  // GitHub Actions runs a bash `run:` step as `bash --noprofile --norc -e -o pipefail`.
  let threw = false;
  try {
    execFileSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: outFile },
      stdio: 'pipe',
    });
  } catch {
    threw = true; // non-zero exit -> the runner would mark steps.plan.outcome == 'failure'
  }

  const ghOutput = fs.readFileSync(outFile, 'utf8');
  const planOut = fs.existsSync('/tmp/plan.out') ? fs.readFileSync('/tmp/plan.out', 'utf8') : null;
  const tmpLeaked = fs.existsSync('/tmp/plan.tmp') || fs.existsSync('/tmp/plan.raw');
  const m = ghOutput.match(/plan_exitcode=(\d+)/);
  return { plan_exitcode: m ? m[1] : null, planOut, stepFailed: threw, tmpLeaked };
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✓ PASSED  ${name}`); passed++; }
  catch (err) { console.log(`✗ FAILED  ${name}\n   ${err.message}`); failed++; }
}

console.log('Running plan-gate tests...\n');

test('the gate reads plan_exitcode and the step outcome, not the wrapper exitcode', () => {
  const action = fs.readFileSync(ACTION, 'utf8');
  assert.ok(
    /if:\s*steps\.plan\.outputs\.plan_exitcode\s*!=\s*'0'\s*\|\|\s*steps\.plan\.outcome\s*==\s*'failure'/.test(action),
    'gate must key off the captured plan_exitcode AND the step outcome',
  );
  assert.ok(
    !/steps\.plan\.outputs\.exitcode\s*==\s*1/.test(action),
    'the old wrapper-based gate must be gone',
  );
});

test('a successful plan records exit 0 and renders via terraform show', () => {
  const { plan_exitcode, planOut, stepFailed, tmpLeaked } = runPlanStep(0);
  assert.strictEqual(plan_exitcode, '0');
  assert.ok(!stepFailed, 'a clean plan+show should not fail the step');
  assert.ok(planOut && planOut.includes('rendered plan from show'), 'plan.out should hold the show render');
  assert.ok(!tmpLeaked, 'plan.tmp / plan.raw must be cleaned up');
});

test('a failed plan records its real exit code, not the show exit code', () => {
  const { plan_exitcode, planOut, tmpLeaked } = runPlanStep(1);
  assert.strictEqual(plan_exitcode, '1', 'must capture the plan exit code (1), not show (0)');
  assert.ok(planOut && planOut.includes('something broke'), 'failure output must be preserved for the comment');
  assert.ok(!tmpLeaked, 'plan.tmp / plan.raw must be cleaned up on the failure path too');
});

test('a show that fails after a clean plan still fails the step (outcome gate catches it)', () => {
  // plan exits 0, show exits 1: under -e the step aborts, so plan_exitcode stays 0 but the
  // step fails -> the runner marks outcome=failure and the gate fires on it.
  const { plan_exitcode, stepFailed } = runPlanStep(0, 1);
  assert.strictEqual(plan_exitcode, '0', 'the plan itself succeeded, so plan_exitcode is 0');
  assert.ok(stepFailed, 'a failing show must fail the step so the outcome gate can catch it');
});

console.log('\n' + '='.repeat(50));
console.log(`Tests completed: ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log('='.repeat(50));
if (failed > 0) process.exit(1);
