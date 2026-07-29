#!/usr/bin/env node

/**
 * Tests for scripts/apply.sh, the shared terraform-apply runner. Runs the REAL script against a
 * fake terraform, so the exit-code capture and the SIGPIPE-prone extraction are exercised rather
 * than mirrored, plus the wiring both actions depend on.
 *
 * Usage: node tests/test-apply-error-extract.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APPLY_SH = path.join(ROOT, 'scripts', 'apply.sh');
const ACTIONS = ['terraform-apply', 'terraform-apply-gcp'];

/**
 * Run apply.sh with a fake terraform that prints `output` and exits `applyCode`.
 * Returns the published outputs, whether the step failed, and whether the log survived.
 */
function runApply(applyCode, output, { maxBytes, planFile } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-'));
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-temp-'));
  const outFile = path.join(dir, 'gh_output');
  const payload = path.join(dir, 'payload');

  fs.writeFileSync(payload, output);
  // The log is created before terraform runs and removed after, so its mode is captured from here.
  fs.writeFileSync(path.join(dir, 'terraform'), `#!/usr/bin/env bash
echo "args: $*" > ${JSON.stringify(path.join(dir, 'args'))}
{ stat -c '%a' "\${RUNNER_TEMP}/apply.out" || stat -f '%Lp' "\${RUNNER_TEMP}/apply.out"; } \
  > ${JSON.stringify(path.join(dir, 'logmode'))} 2>/dev/null
cat ${JSON.stringify(payload)} >&2
exit ${applyCode}
`);
  fs.chmodSync(path.join(dir, 'terraform'), 0o755);
  fs.writeFileSync(outFile, '');

  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    GITHUB_OUTPUT: outFile,
    REFRESH: 'true',
    RUNNER_TEMP: runnerTemp,
  };
  if (maxBytes) env.MAX_ERROR_BYTES = String(maxBytes);
  if (planFile) env.PLAN_FILE = planFile;

  let stepFailed = false;
  try {
    execFileSync('bash', [APPLY_SH], { cwd: dir, env, stdio: 'pipe' });
  } catch { stepFailed = true; }

  const modeFile = path.join(dir, 'logmode');
  const logMode = fs.existsSync(modeFile) ? fs.readFileSync(modeFile, 'utf8').trim() : null;
  const raw = fs.readFileSync(outFile, 'utf8');
  const read = name => {
    const m = raw.match(new RegExp(`^${name}<<(\\S+)\\n([\\s\\S]*?)\\n\\1$`, 'm'));
    return m ? m[2] : null;
  };
  const result = {
    detail: read('error_detail'),
    slackMessage: read('slack_message'),
    args: fs.existsSync(path.join(dir, 'args')) ? fs.readFileSync(path.join(dir, 'args'), 'utf8') : '',
    // The old fixed path is checked too, so a regression back to it still reads as a leak.
    logLeaked: fs.existsSync(path.join(runnerTemp, 'apply.out')) || fs.existsSync('/tmp/apply.out'),
    logMode,
    stepFailed,
  };

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(runnerTemp, { recursive: true, force: true });
  return result;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✓ PASSED  ${name}`); passed++; }
  catch (e) { console.log(`✗ FAILED  ${name}\n   ${e.message}`); failed++; }
}

console.log('Running apply-error-extract tests...\n');

// --- the script -----------------------------------------------------------------------------

test('a successful apply exits 0, publishes nothing, and leaves no log', () => {
  const r = runApply(0, 'Apply complete! Resources: 1 added.\n');
  assert.ok(!r.stepFailed, 'clean apply should not fail the step');
  assert.strictEqual(r.detail, null, 'no error_detail on the success path');
  assert.ok(!r.logLeaked, 'the apply log is cleaned up');
});

test('a failed apply fails the step and extracts from the first Error: block', () => {
  const r = runApply(1, 'Acquiring state lock...\nError: Error acquiring the state lock\n\nLock Info:\n  ID: abc\n');
  assert.ok(r.stepFailed, 'a failed apply must fail the step');
  assert.ok(r.detail.startsWith('Error: Error acquiring the state lock'), `starts at the error block, got: ${r.detail}`);
  assert.ok(!r.detail.includes('Acquiring state lock...'), 'pre-error noise dropped');
  assert.ok(r.detail.includes('ID: abc'), 'the rest of the error block is kept');
  assert.ok(!r.logLeaked, 'apply output can be sensitive - it must not survive the job');
});

test('slack_message is the error in a code fence', () => {
  const r = runApply(1, 'Error: quota exceeded\n');
  assert.strictEqual(r.slackMessage, '```Error: quota exceeded```');
});

test('a boxed (framed) terraform error is matched too', () => {
  const r = runApply(1, 'noise\n╷\n│ Error: creating S3 Bucket: AccessDenied\n│\n╵\n');
  assert.ok(r.detail.includes('AccessDenied'), `boxed error must match, got: ${r.detail}`);
});

test('ANSI colour codes are stripped so the anchor still matches', () => {
  const r = runApply(1, 'noise\n[31m[1mError: quota exceeded[0m\n');
  assert.ok(r.detail.startsWith('Error: quota exceeded'), `ANSI must be stripped, got: ${JSON.stringify(r.detail)}`);
});

// Regression: head -c closes the pipe early on a long error, and the SIGPIPE it sends upstream
// used to kill the script under pipefail before it published anything.
test('an error longer than the cap is truncated, not lost', () => {
  const r = runApply(1, 'Error: boom\n' + 'x'.repeat(200000) + '\n', { maxBytes: 500 });
  assert.ok(r.detail !== null, 'output must still be published when head closes the pipe early');
  assert.ok(r.detail.startsWith('Error: boom'), 'truncated detail still starts at the error');
  assert.ok(r.detail.length <= 500, `detail capped, got ${r.detail.length}`);
});

test('a failure with no Error: block falls back to the log tail', () => {
  const r = runApply(2, 'terraform: command bailed out with no rendered error\n');
  assert.ok(r.detail && r.detail.includes('bailed out'), `expected a tail fallback, got: ${r.detail}`);
});

test('a triple backtick in the error cannot break out of the Slack code fence', () => {
  const r = runApply(1, 'Error: bad value ```\nstill inside\n');
  assert.ok(!r.detail.includes('```'), `fence terminator must be neutralized, got: ${r.detail}`);
  assert.ok(r.slackMessage.startsWith('```') && r.slackMessage.endsWith('```'), 'exactly one fence pair');
  assert.strictEqual(r.slackMessage.split('```').length, 3, 'no stray fence inside the block');
});

// The cap is in bytes, so it can land inside a multi-byte character - terraform's own frame is
// three bytes wide, and the payload below is cut mid-emoji.
test('truncation never emits invalid UTF-8', () => {
  const r = runApply(1, 'Error: xxxxxxxx\u{1F525} tail\n', { maxBytes: 17 });
  assert.strictEqual(r.detail, 'Error: xxxxxxxx', 'the incomplete character is dropped, not half-emitted');
  assert.ok(Buffer.from(r.detail, 'utf8').toString('utf8') === r.detail, 'must round-trip as UTF-8');
});

// The apply output is not secret-masked, so on a shared runner it must not be world-readable for
// the lifetime of the apply.
test('the apply log is created 0600, before terraform writes to it', () => {
  assert.strictEqual(runApply(0, 'Apply complete!\n').logMode, '600');
});

test('shell metacharacters in the error are data, never expanded', () => {
  const r = runApply(1, 'Error: bad name "$(id)" and `whoami` and ${HOME}\n');
  assert.ok(r.detail.includes('$(id)'), 'command substitution stays literal');
  assert.ok(r.detail.includes('`whoami`'), 'backticks stay literal');
  assert.ok(r.detail.includes('${HOME}'), 'parameter expansion stays literal');
});

test('printf format specifiers in the error are not interpreted', () => {
  const r = runApply(1, 'Error: got %s expected %d (100%%)\n');
  assert.ok(r.detail.includes('%s expected %d'), `format specifiers stay literal, got: ${r.detail}`);
});

test('a failure with nothing to report publishes no empty code block', () => {
  const r = runApply(3, '');
  assert.strictEqual(r.slackMessage, null, 'an empty fence would post an empty code block');
});

test('an error containing the heredoc delimiter cannot forge an output', () => {
  const sh = fs.readFileSync(APPLY_SH, 'utf8');
  assert.match(sh, /grep -v -x -F "\$\{delimiter\}"/, 'delimiter lines must be dropped from the body');
  assert.match(sh, /RANDOM/, 'the delimiter must not be fixed and guessable');
});

test('the apply log lives in RUNNER_TEMP, not a fixed /tmp path', () => {
  const sh = fs.readFileSync(APPLY_SH, 'utf8');
  assert.match(sh, /RUNNER_TEMP:-\/tmp/, 'must derive the log path from RUNNER_TEMP');
  assert.doesNotMatch(sh, /\/tmp\/apply\.out/, 'no fixed /tmp/apply.out reference may remain');
});

test('terraform own exit code is captured, not the pipeline/tee status', () => {
  const sh = fs.readFileSync(APPLY_SH, 'utf8');
  assert.match(sh, /code=\$\{PIPESTATUS\[0\]\}/, 'must read PIPESTATUS[0] so tee cannot mask the apply code');
});

test('PLAN_FILE is applied when set, and omitted when not', () => {
  assert.match(runApply(0, '', { planFile: '/tmp/plan.tmp' }).args, /\/tmp\/plan\.tmp/, 'gcp applies a saved plan');
  assert.doesNotMatch(runApply(0, '').args, /plan\.tmp/, 'aws applies without one');
});

// --- the wiring both actions depend on ------------------------------------------------------

for (const action of ACTIONS) {
  const yml = fs.readFileSync(path.join(ROOT, 'actions', action, 'action.yml'), 'utf8');
  const label = s => `[${action}] ${s}`;

  // The saved plan carries resource attributes, so it gets the same per-job treatment as the log.
  test(label('keeps its terraform artifacts out of a shared /tmp'), () => {
    assert.doesNotMatch(yml, /\/tmp\/plan\./, 'no fixed /tmp plan path may remain');
  });

  test(label('runs the shared script rather than its own copy'), () => {
    assert.match(yml, /run: bash "\$\{GITHUB_ACTION_PATH\}\/\.\.\/\.\.\/scripts\/apply\.sh"/, 'must call scripts/apply.sh');
    assert.ok(!fs.existsSync(path.join(ROOT, 'actions', action, 'scripts', 'apply.sh')), 'no per-action copy may return');
  });

  test(label('exports the error and puts it in the failure notification'), () => {
    assert.match(yml, /value: \$\{\{ steps\.tf_apply\.outputs\.error_detail \}\}/, 'error_detail must be an action output');
    assert.match(yml, /message: \$\{\{ steps\.tf_apply\.outputs\.slack_message \}\}/, 'failure notification carries the error');
    assert.match(yml, /gh-actions-slack-notify@v0\.2\.0/, 'the message input needs slack-notify >= v0.2.0');
  });

  // The commit list came from slack-notify's own default before, so it was invisible here and
  // silently unconfigurable.
  test(label('both notifications list the recent commits, from a declared input'), () => {
    assert.match(yml, /^ {2}num_commits:\n/m, 'num_commits must be a declared input');
    assert.match(yml, /required: false\n {4}default: "3"/, 'default 3 recent commits');
    assert.strictEqual((yml.match(/num-commits: \$\{\{ inputs\.num_commits \}\}/g) || []).length, 2,
      'both the success and failure notifications must pass it');
  });
}

console.log('\n' + '='.repeat(50));
console.log(`Passed: ${passed}\nFailed: ${failed}`);
console.log('='.repeat(50));
if (failed > 0) process.exit(1);
