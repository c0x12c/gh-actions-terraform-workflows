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
  return { out, summary: fs.readFileSync(sumFile, 'utf8') };
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

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall passed');
