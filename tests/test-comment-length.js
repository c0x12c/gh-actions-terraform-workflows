#!/usr/bin/env node

/**
 * Unit test for GitHub comment length validation against the REAL shared module.
 *
 * Usage: node tests/test-comment-length.js
 */

const assert = require('assert');
const path = require('path');

const { runPostComment } = require(path.join(__dirname, 'helpers', 'post-comment-harness.js'));

const MAX_COMMENT_LENGTH = 65536;

async function render(options = {}) {
  const { call } = await runPostComment({ mode: 'new', ...options });
  return call.body;
}

async function findExactBoundaryLength(options = {}) {
  const one = await render({ ...options, planBody: 'x' });
  const two = await render({ ...options, planBody: 'xx' });
  const baseLength = one.length - 1;

  assert.strictEqual(two.length - one.length, 1, 'plan growth should be linear before truncation');

  return MAX_COMMENT_LENGTH - baseLength;
}

async function runTests() {
  console.log('Running comment length validation tests...\n');

  let passed = 0;
  let failed = 0;

  try {
    console.log('Test 1: Small plan (should not truncate)');
    const smallPlan = '+ resource "aws_instance" "test" {\n  + ami = "ami-12345"\n}';
    const comment = await render({ planBody: smallPlan, validationBody: 'Validation successful' });
    assert.strictEqual(comment.includes(smallPlan), true, 'Small plan should be included');
    assert.strictEqual(comment.includes('truncated'), false, 'Should not include truncation notice');
    assert.strictEqual(comment.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${comment.length} > ${MAX_COMMENT_LENGTH}`);
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  try {
    console.log('Test 2: Large plan (should truncate)');
    const largePlan = '+ resource "aws_instance" "test" {\n' + '+'.repeat(70000) + '\n}';
    const comment = await render({ planBody: largePlan, validationBody: 'Validation successful' });
    assert.strictEqual(comment.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${comment.length} > ${MAX_COMMENT_LENGTH}`);
    assert.strictEqual(comment.includes('truncated'), true, 'Should include truncation notice');
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  try {
    console.log('Test 3: Extremely large plan (should truncate with notice)');
    const hugePlan = '+'.repeat(200000);
    const comment = await render({ planBody: hugePlan, validationBody: 'Validation successful' });
    assert.strictEqual(comment.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${comment.length} > ${MAX_COMMENT_LENGTH}`);
    assert.strictEqual(comment.includes('truncated'), true, 'Should include truncation notice');
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  try {
    console.log('Test 3b: Massive validation output (should show minimal message)');
    const massiveValidationOutput = 'x'.repeat(65200);
    const largePlan = '+'.repeat(1000);
    const comment = await render({ validationBody: massiveValidationOutput, planBody: largePlan });
    assert.strictEqual(comment.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${comment.length} > ${MAX_COMMENT_LENGTH}`);
    assert.strictEqual(comment.includes('too large to display'), true, 'Should show minimal message when base is too large');
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  try {
    console.log('Test 4: Apply comment with small plan');
    const smallPlan = '+ resource "aws_instance" "test" {\n  + ami = "ami-12345"\n}';
    const comment = await render({ kind: 'apply', planBody: smallPlan });
    assert.strictEqual(comment.includes(smallPlan), true, 'Small plan should be included');
    assert.strictEqual(comment.includes('truncated'), false, 'Should not include truncation notice');
    assert.strictEqual(comment.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${comment.length} > ${MAX_COMMENT_LENGTH}`);
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  try {
    console.log('Test 5: Apply comment with large plan');
    const summary = 'Plan: 7 to add, 2 to change, 1 to destroy.';
    const largePlan = `${'# apply noise\n'.repeat(20000)}\n${summary}`;
    const comment = await render({ kind: 'apply', planBody: largePlan });
    assert.strictEqual(comment.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${comment.length} > ${MAX_COMMENT_LENGTH}`);
    assert.strictEqual(comment.includes('truncated'), true, 'Should include truncation notice');
    assert.strictEqual(comment.split(summary).length - 1, 2, 'Apply summary should be pinned and retained in the tail');
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  try {
    console.log('Test 6: Plan at the exact limit');
    const exactPlanLength = await findExactBoundaryLength({ validationBody: 'Validation successful' });
    const comment = await render({
      validationBody: 'Validation successful',
      planBody: 'x'.repeat(exactPlanLength),
    });
    assert.strictEqual(comment.length, MAX_COMMENT_LENGTH, `Should land exactly on the limit: ${comment.length} !== ${MAX_COMMENT_LENGTH}`);
    assert.strictEqual(comment.includes('truncated'), false, 'Should not include truncation notice');
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  try {
    console.log('Test 7: Apply at the exact limit');
    const exactApplyLength = await findExactBoundaryLength({ kind: 'apply' });
    const comment = await render({ kind: 'apply', planBody: 'x'.repeat(exactApplyLength) });
    assert.strictEqual(comment.length, MAX_COMMENT_LENGTH, `Should land exactly on the limit: ${comment.length} !== ${MAX_COMMENT_LENGTH}`);
    assert.strictEqual(comment.includes('truncated'), false, 'Should not truncate when it fits');
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  try {
    console.log('Test 8: Sticky marker counts toward the comment budget');
    const marker = '<!-- terraform-plan:dev:environments/dev -->';
    const plan = '+'.repeat(200000);
    const sticky = await render({ mode: 'sticky', marker, planBody: plan, validationBody: 'Validation successful' });
    const plain = await render({ planBody: plan, validationBody: 'Validation successful' });

    assert.strictEqual(sticky.startsWith(`${marker}\n`), true, 'Sticky output should lead with the marker');
    assert.strictEqual(sticky.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${sticky.length}`);
    assert.strictEqual(
      sticky.length - plain.length <= marker.length + 1,
      true,
      'Marker must be accounted for in the budget, not appended on top of a full-size comment',
    );
    console.log(`   Sticky: ${sticky.length} chars, plain: ${plain.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  try {
    console.log('Test 9: Truncation keeps the plan summary line');
    const summary = 'Plan: 12 to add, 3 to change, 1 to destroy.';
    const plan = `${'# leading resource noise\n'.repeat(4000)}\n${summary}`;
    const output = await render({ planBody: plan, validationBody: 'Validation successful' });

    assert.strictEqual(output.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${output.length}`);
    assert.strictEqual(output.split(summary).length - 1, 2, 'Truncated comment must pin and retain the plan summary line');
    assert.strictEqual(output.includes('showing the last'), true, 'Notice should say which end survived');
    console.log(`   Comment length: ${output.length} chars, summary retained`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  console.log('='.repeat(50));
  console.log(`Tests completed: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('='.repeat(50));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
