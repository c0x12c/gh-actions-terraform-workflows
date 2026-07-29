#!/usr/bin/env node

/**
 * Tests for the terraform-apply error extraction. Runs the REAL scripts/apply.sh against a fake
 * terraform, so the exit-code capture and the SIGPIPE-prone extraction are exercised, not mirrored.
 *
 * The AWS and GCP actions keep separate copies of the script (they are consumed independently by
 * subpath), so the extraction suite runs against both.
 *
 * Usage: node tests/test-apply-error-extract.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const VARIANTS = ['terraform-apply', 'terraform-apply-gcp'].map(a => ({
  action: a,
  sh: path.join(ROOT, 'actions', a, 'scripts', 'apply.sh'),
  yml: path.join(ROOT, 'actions', a, 'action.yml'),
}));

let APPLY_SH = VARIANTS[0].sh;

/** Run apply.sh with a fake terraform that exits `applyCode` after printing `output`. */
function runApply(applyCode, output, maxBytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-error-'));
  const outFile = path.join(dir, 'gh_output');
  const payload = path.join(dir, 'payload');
  fs.writeFileSync(payload, output);
  fs.writeFileSync(path.join(dir, 'terraform'), `#!/usr/bin/env bash
cat ${JSON.stringify(payload)} >&2
exit ${applyCode}
`);
  fs.chmodSync(path.join(dir, 'terraform'), 0o755);
  fs.writeFileSync(outFile, '');
  fs.rmSync('/tmp/apply.out', { force: true });

  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: outFile, REFRESH: 'true' };
  if (maxBytes) env.MAX_ERROR_BYTES = String(maxBytes);

  let stepFailed = false;
  try {
    execFileSync('bash', [APPLY_SH], { cwd: dir, env, stdio: 'pipe' });
  } catch { stepFailed = true; }

  const raw = fs.readFileSync(outFile, 'utf8');
  // GITHUB_OUTPUT heredoc: error_detail<<DELIM \n <body> \n DELIM
  const m = raw.match(/^error_detail<<(\S+)\n([\s\S]*)\n\1\n?$/m);
  const logLeaked = fs.existsSync('/tmp/apply.out');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync('/tmp/apply.out', { force: true });
  return { rawOutput: raw, detail: m ? m[2] : null, stepFailed, logLeaked };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✓ PASSED  ${name}`); passed++; }
  catch (e) { console.log(`✗ FAILED  ${name}\n   ${e.message}`); failed++; }
}

console.log('Running apply-error-extract tests...\n');

for (const variant of VARIANTS) {
  APPLY_SH = variant.sh;
  const ACTION = variant.yml;
  const label = s => `[${variant.action}] ${s}`;

  test(label('apply.sh captures terraform own exit code via PIPESTATUS, not the pipeline/tee status'), () => {
    const sh = fs.readFileSync(APPLY_SH, 'utf8');
    assert.ok(/apply_code=\$\{PIPESTATUS\[0\]\}/.test(sh), 'must read PIPESTATUS[0] so tee cannot mask the apply code');
  });

  test(label('action wires the error into the failure notification and exports it'), () => {
    const a = fs.readFileSync(ACTION, 'utf8');
    assert.ok(/value:\s*\$\{\{\s*steps\.tf_apply\.outputs\.error_detail\s*\}\}/.test(a), 'error_detail must be an action output');
    assert.ok(/message:.*steps\.tf_apply\.outputs\.error_detail/.test(a), 'failure notification must pass the error as message');
    assert.ok(/gh-actions-slack-notify@v0\.2\.0/.test(a), 'message input needs slack-notify >= v0.2.0');
  });

  test(label('a successful apply exits 0 and publishes no error detail'), () => {
    const r = runApply(0, 'Apply complete! Resources: 1 added.\n');
    assert.ok(!r.stepFailed, 'clean apply should not fail the step');
    assert.strictEqual(r.detail, null, 'no error_detail on the success path');
    assert.ok(!r.logLeaked, 'the apply log is cleaned up on the success path');
  });

  test(label('the apply log is not left behind on the failure path either'), () => {
    const r = runApply(1, 'Error: nope\n');
    assert.ok(!r.logLeaked, 'apply output can be sensitive - it must not survive on a self-hosted runner');
  });

  // A fence terminator in the error would close the Slack code block early and let the rest of
  // the output render as mrkdwn.
  test(label('a triple backtick in the error cannot break out of the Slack code fence'), () => {
    const r = runApply(1, 'Error: bad value ```\nstill inside\n');
    assert.ok(!r.detail.includes('```'), `fence terminator must be neutralized, got: ${r.detail}`);
    assert.ok(r.detail.includes('still inside'), 'the rest of the error is kept');
  });

  test(label('a failed apply fails the step and extracts from the first Error: block'), () => {
    const r = runApply(1, 'Acquiring state lock...\nError: Error acquiring the state lock\n\nLock Info:\n  ID: abc\n');
    assert.ok(r.stepFailed, 'a failed apply must fail the step');
    assert.ok(r.detail.startsWith('Error: Error acquiring the state lock'), `detail starts at the error block, got: ${r.detail}`);
    assert.ok(!r.detail.includes('Acquiring state lock...'), 'pre-error noise dropped');
    assert.ok(r.detail.includes('ID: abc'), 'the rest of the error block is kept');
  });

  test(label('a boxed (framed) terraform error is matched too'), () => {
    const r = runApply(1, 'noise\n╷\n│ Error: creating S3 Bucket: AccessDenied\n│\n╵\n');
    assert.ok(r.detail.includes('AccessDenied'), `boxed error must match, got: ${r.detail}`);
  });

  test(label('ANSI colour codes are stripped so the anchor still matches'), () => {
    const r = runApply(1, 'noise\n\u001b[31m\u001b[1mError: quota exceeded\u001b[0m\n');
    assert.ok(r.detail.startsWith('Error: quota exceeded'), `ANSI must be stripped, got: ${JSON.stringify(r.detail)}`);
  });

  // Regression: head -c closes the pipe early on a long error, and the SIGPIPE it sends upstream
  // used to kill the script under pipefail before it wrote GITHUB_OUTPUT - losing exactly the
  // errors worth reporting.
  test(label('an error longer than the cap is truncated, not lost'), () => {
    const long = 'Error: boom\n' + 'x'.repeat(200000) + '\n';
    const r = runApply(1, long, 500);
    assert.ok(r.detail !== null, 'output must still be written when head closes the pipe early');
    assert.ok(r.detail.startsWith('Error: boom'), 'truncated detail still starts at the error');
    assert.ok(r.detail.length <= 500, `detail capped, got ${r.detail.length}`);
    assert.ok(r.stepFailed, 'still fails the step');
  });

  test(label('a failure with no Error: block falls back to the log tail'), () => {
    const r = runApply(2, 'terraform: command bailed out with no rendered error\n');
    assert.ok(r.detail && r.detail.includes('bailed out'), `expected a tail fallback, got: ${r.detail}`);
  });

  test(label('an error containing the heredoc delimiter cannot forge output entries'), () => {
    const sh = fs.readFileSync(APPLY_SH, 'utf8');
    assert.ok(/grep -v -x -F "\$\{delimiter\}"/.test(sh), 'delimiter lines must be filtered out of the body');
    assert.ok(/RANDOM/.test(sh), 'delimiter must not be a fixed, guessable string');
  });

}

console.log('\n' + '='.repeat(50));
console.log(`Passed: ${passed}\nFailed: ${failed}`);
console.log('='.repeat(50));
if (failed > 0) process.exit(1);
