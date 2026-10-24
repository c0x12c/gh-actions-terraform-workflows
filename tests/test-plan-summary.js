#!/usr/bin/env node

/**
 * Tests for the terraform-plan summary step. Runs the REAL
 * actions/terraform-plan/scripts/plan-summary.sh against fixture plan output, so the parsing and
 * the job-summary rendering are exercised rather than mirrored.
 *
 * Usage: node tests/test-plan-summary.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'actions', 'terraform-plan', 'scripts', 'plan-summary.sh');

function run(planOut, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-summary-'));
  if (planOut !== null) fs.writeFileSync(path.join(dir, 'plan.out'), planOut);
  const outFile = path.join(dir, 'out.txt');
  const sumFile = path.join(dir, 'summary.md');
  fs.writeFileSync(outFile, '');
  fs.writeFileSync(sumFile, '');

  // Minimal environment on purpose: the script needs only these, and an explicit set keeps the
  // test from depending on whatever the caller happens to export.
  const env = Object.assign({
    PATH: '/usr/bin:/bin:/usr/local/bin',
    RUNNER_TEMP: dir,
    GITHUB_OUTPUT: outFile,
    GITHUB_STEP_SUMMARY: sumFile,
  }, extraEnv);

  execFileSync('bash', [SCRIPT], { env, stdio: ['ignore', 'ignore', 'ignore'] });

  const out = {};
  const lines = fs.readFileSync(outFile, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<<')) {
      const [key, delim] = lines[i].split('<<');
      const buf = [];
      for (i++; i < lines.length && lines[i] !== delim; i++) buf.push(lines[i]);
      out[key] = buf.join('\n');
    } else if (lines[i].includes('=')) {
      const idx = lines[i].indexOf('=');
      out[lines[i].slice(0, idx)] = lines[i].slice(idx + 1);
    }
  }
  return { out, summary: fs.readFileSync(sumFile, 'utf8'), dir };
}

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL - ${name}\n    ${e.message}`);
  }
}

const UPDATE_ONLY = `Terraform will perform the following actions:

  # module.a.aws_db_instance.this will be updated in-place
  ~ resource "aws_db_instance" "this" {
      ~ deletion_protection = false -> true
    }

  # module.b.aws_db_instance.this will be updated in-place
  ~ resource "aws_db_instance" "this" {
    }

Plan: 0 to add, 2 to change, 0 to destroy.
`;

const DESTRUCTIVE = `  # module.a.aws_instance.old will be destroyed
  # module.b.aws_security_group.this must be replaced
  # module.c.aws_db_instance.this will be updated in-place

Plan: 1 to add, 1 to change, 2 to destroy.
`;

// A value that merely mentions destruction must not report a destructive plan.
const INNOCENT_VALUE = `  # module.a.aws_s3_bucket.this will be updated in-place
  ~ resource "aws_s3_bucket" "this" {
      ~ tags = {
          ~ note = "old" -> "this bucket will be destroyed next quarter"
        }
    }

Plan: 0 to add, 1 to change, 0 to destroy.
`;

console.log('plan-summary');

test('reports counts and one row per changing resource', () => {
  const { out } = run(UPDATE_ONLY);
  assert.strictEqual(out.counts, 'Plan: 0 to add, 2 to change, 0 to destroy.');
  assert.strictEqual(out.total, '2');
  assert.strictEqual(out.has_destroy, 'false');
  assert.strictEqual(out.changes.split('\n').length, 2);
});

test('counts a replacement, which terraform renders as "must be replaced"', () => {
  const { out } = run(DESTRUCTIVE);
  assert.strictEqual(out.total, '3', 'replacement row must be counted');
  assert.ok(out.changes.includes('must be replaced'), 'replacement row must be listed');
  assert.strictEqual(out.has_destroy, 'true');
});

test('does not report a destructive plan for an attribute value mentioning destruction', () => {
  const { out } = run(INNOCENT_VALUE);
  assert.strictEqual(out.has_destroy, 'false');
});

test('degrades without failing when plan.out is absent', () => {
  const { out } = run(null);
  assert.strictEqual(out.counts, '');
  assert.strictEqual(out.has_destroy, 'false');
  assert.strictEqual(out.total, '0');
});

test('caps rows at plan_max_rows while total stays truthful', () => {
  const rows = Array.from(
    { length: 30 },
    (_, i) => `  # module.m${i}.aws_s3_bucket.this will be updated in-place`,
  ).join('\n');
  const { out } = run(`${rows}\n\nPlan: 0 to add, 30 to change, 0 to destroy.\n`, {
    PLAN_MAX_ROWS: '5',
  });
  assert.strictEqual(out.changes.split('\n').length, 5);
  assert.strictEqual(out.total, '30', 'total must not be capped');
});

test('a plan carrying delimiter-shaped lines injects no extra output', () => {
  // Two layers stop heredoc-termination injection. The change filter admits only lines carrying
  // "will be " or "must be ", which no bare delimiter word does, and the delimiter is randomised
  // so even a line that did reach the payload could not close the block. This pins both.
  const { out } = run(
    '  # PLAN_EOF\n' +
      '  # injected=surprise\n' +
      '  # module.a.aws_s3_bucket.this will be updated in-place\n\n' +
      'Plan: 0 to add, 1 to change, 0 to destroy.\n',
  );
  assert.strictEqual(out.injected, undefined, 'nothing may be injected as a separate output');
  assert.strictEqual(out.changes, 'module.a.aws_s3_bucket.this will be updated in-place');
  assert.strictEqual(out.total, '1', 'delimiter-shaped lines are not resource rows');
});

test('ignores data-source reads, which are not changing resources', () => {
  // Terraform excludes these from its own add/change/destroy counts, so counting them would make
  // total disagree with the summary line the same notice prints.
  const { out } = run(
    '  # data.aws_ami.ubuntu will be read during apply\n'
      + '  #  (depends on a resource or a module with changes pending)\n'
      + '  # module.a.aws_s3_bucket.this will be updated in-place\n\n'
      + 'Plan: 0 to add, 1 to change, 0 to destroy.\n',
  );
  assert.strictEqual(out.total, '1');
  assert.ok(!out.changes.includes('data.aws_ami'), 'data source must not be listed');
});

test('an address embedding a destructive phrase is judged by its verb', () => {
  const { out } = run(
    '  # aws_instance.foo["will be destroyed"] will be updated in-place\n\n'
      + 'Plan: 0 to add, 1 to change, 0 to destroy.\n',
  );
  assert.strictEqual(out.has_destroy, 'false', 'the verb is "updated in-place"');
  assert.strictEqual(out.total, '1');
});

test('emits an empty changes payload rather than a placeholder address', () => {
  const { out } = run('No changes. Your infrastructure matches the configuration.\n');
  assert.strictEqual(out.counts, 'No changes. Your infrastructure matches the configuration.');
  assert.strictEqual(out.total, '0');
  assert.strictEqual(out.changes, '', 'a caller rendering this as a list must print nothing');
});

test('a plan containing a fence cannot close the job summary block early', () => {
  const planWithFence = '  # module.a.aws_s3_bucket.this will be updated in-place\n'
    + '  ~ resource "aws_s3_bucket" "this" {\n'
    + '      ~ policy = <<-EOT\n'
    + '```\n'
    + 'closing fence inside a heredoc\n'
    + '```\n'
    + '        EOT\n'
    + '    }\n\n'
    + 'Plan: 0 to add, 1 to change, 0 to destroy.\n';
  const { summary } = run(planWithFence);
  assert.ok(summary.includes('closing fence inside a heredoc'), 'body survives');
  assert.ok(summary.includes('Plan: 0 to add, 1 to change, 0 to destroy.'), 'tail survives');
  const opener = summary.match(/^(`{3,})terraform$/m);
  assert.ok(opener, 'a fence is opened');
  assert.ok(opener[1].length >= 4, 'fence must outrun the plan content');
});

test('writes the full plan into the job summary', () => {
  const { summary } = run(UPDATE_ONLY);
  assert.ok(summary.includes('### Terraform plan'), 'heading');
  assert.ok(summary.includes('Plan: 0 to add, 2 to change, 0 to destroy.'), 'counts');
  assert.ok(summary.includes('deletion_protection'), 'full plan body, not just addresses');
});

test('flags destruction in the job summary heading', () => {
  const { summary } = run(DESTRUCTIVE);
  assert.ok(/DESTROYS OR REPLACES/.test(summary), 'heading must flag it');
});

test('a small plan summary is byte-identical to the uncapped rendering', () => {
  const { summary } = run(UPDATE_ONLY);
  const expected = '### Terraform plan\n\n**Plan: 0 to add, 2 to change, 0 to destroy.**\n\n'
    + '<details><summary>Full plan</summary>\n\n```terraform\n' + UPDATE_ONLY + '```\n\n</details>\n';
  assert.strictEqual(summary, expected);
});

test('a plan over the cap is cut at a whole line, noted, and stays under 1 MiB', () => {
  // Multibyte characters in every filler line, so a byte cut mid-character would show as U+FFFD.
  const filler = '      ~ description = "café ✓ ' + 'x'.repeat(80) + '"\n';
  const head = '  # module.a.aws_s3_bucket.this will be updated in-place\n';
  const tail = '  # module.z.aws_instance.old will be destroyed\n\nPlan: 0 to add, 1 to change, 1 to destroy.\n';
  const plan = head + filler.repeat(Math.ceil(1.5 * 1024 * 1024 / Buffer.byteLength(filler))) + tail;
  assert.ok(Buffer.byteLength(plan) > 1.4 * 1024 * 1024);
  const { out, summary } = run(plan);
  assert.ok(Buffer.byteLength(summary) < 1048576, 'summary must fit the 1 MiB step-summary limit');
  assert.ok(summary.includes('truncated'), 'heading or notice must say so');
  assert.ok(summary.includes("this job's log"), 'notice must point at the job log');
  assert.ok(summary.includes(String(Buffer.byteLength(plan))), 'notice must name the total bytes');
  assert.ok(!summary.includes('�'), 'no partial UTF-8 character');
  const m = summary.match(/^(`{3,})terraform\n([\s\S]*?)\n\1\n/m);
  assert.ok(m, 'the fenced block is closed');
  assert.ok(m[2].split('\n').every(l => l === '' || l === head.trimEnd() || l === filler.trimEnd()),
    'every shown line is a whole line');
  assert.ok(!summary.includes('will be destroyed'), 'the tail is cut');
  assert.ok(summary.indexOf('</details>') > summary.indexOf('truncated'), 'notice sits before the close');
  // Outputs come from the whole file, not the cut one.
  assert.strictEqual(out.has_destroy, 'true');
  assert.strictEqual(out.total, '2');
  assert.strictEqual(out.counts, 'Plan: 0 to add, 1 to change, 1 to destroy.');
});

test('plan_summary_max_bytes lowers the cap', () => {
  const plan = Array.from({ length: 50 }, (_, i) => `line ${i}\n`).join('');
  const { summary } = run(plan, { PLAN_SUMMARY_MAX_BYTES: '40' });
  assert.ok(summary.includes('truncated'));
  assert.ok(summary.includes('line 0\n') && !summary.includes('line 49'));
});

// A limit near 1 MiB leaves no room for the heading, fences and notice, so the summary is rejected
// again. The script clamps to a ceiling instead of trusting the input.
test('an oversized plan_summary_max_bytes is clamped below the 1 MiB limit', () => {
  const plan = 'x'.repeat(99) + '\n';
  const { summary } = run(plan.repeat(10600), { PLAN_SUMMARY_MAX_BYTES: '1048576' });
  assert.ok(Buffer.byteLength(summary) < 1048576, `summary is ${Buffer.byteLength(summary)} bytes`);
  assert.ok(summary.includes('truncated'));
});

test('a non-numeric plan_summary_max_bytes falls back to the default', () => {
  const plan = 'y'.repeat(99) + '\n';
  const { summary } = run(plan.repeat(12000), { PLAN_SUMMARY_MAX_BYTES: 'abc' });
  assert.ok(summary.includes('truncated'), 'a bad value must not disable the cap');
  assert.ok(Buffer.byteLength(summary) < 1048576);
});

// The cut copy carries unmasked attributes, so it must not outlive the step.
test('the truncated copy is removed after the step', () => {
  const plan = 'z'.repeat(99) + '\n';
  const { dir } = run(plan.repeat(12000));
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['out.txt', 'plan.out', 'summary.md']);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall passed');
