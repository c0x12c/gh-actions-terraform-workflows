#!/usr/bin/env node

/**
 * Unit test for GitHub comment length validation
 * Tests the truncation logic for Terraform plan/apply comments
 * 
 * Usage: node tools/test-comment-length.js
 */

const assert = require('assert');

const MAX_COMMENT_LENGTH = 65536;

/**
 * Simulates the comment building logic from the GitHub Action (terraform-plan)
 * This matches the exact logic in actions/terraform-plan/action.yml
 */
function buildPlanComment(environment, validationOutput, plan, steps, context) {
  // Apply the backtick escaping logic as in the action
  const escapedValidationOutput = validationOutput.replace(/`/g, '\\`');
  const escapedPlan = plan.replace(/`/g, '\\`');

  const baseHeader = `#### Environment: ${environment}
          #### Terraform Format and Style 🖌\`${steps.fmt.outcome}\`
          #### Terraform Initialization ⚙️\`${steps.init.outcome}\`
          #### Terraform Validation 🤖\`${steps.validate.outcome}\`
          <details><summary>Validation Output</summary>

          \`\`\`\n
          ${escapedValidationOutput}
          \`\`\`

          </details>

          #### Terraform Plan 📖\`${steps.plan.outcome}\`

          <details><summary>Show Plan</summary>

          \`\`\`\n
          `;

  const baseFooter = `
          \`\`\`

          </details>

          *Pusher: @${context.actor}, Action: \`${context.event_name}\`, Working Directory: \`${context.working_dir}\`, Workflow: \`${context.workflow}\`*`;

  const baseLength = baseHeader.length + baseFooter.length;
  let output;

  // Check if comment exceeds GitHub's limit and truncate if necessary
  if (baseLength + escapedPlan.length > MAX_COMMENT_LENGTH) {
    const availableForPlan = MAX_COMMENT_LENGTH - baseLength;
    const truncationNotice = `\n\n... [Plan truncated - showing first ${availableForPlan} characters only. See workflow logs for full output.] ...`;
    const maxPlanLength = availableForPlan - truncationNotice.length;

    if (maxPlanLength > 0) {
      const truncatedPlan = escapedPlan.substring(0, maxPlanLength) + truncationNotice;
      output = `${baseHeader}${truncatedPlan}${baseFooter}`;
    } else {
      output = `#### Environment: ${environment}

              #### Terraform Plan 📖\`${steps.plan.outcome}\`

              Plan output is too large to display. Please check the workflow logs for the full plan.

              *Pusher: @${context.actor}, Action: \`${context.event_name}\`, Working Directory: \`${context.working_dir}\`, Workflow: \`${context.workflow}\`*`;
    }
  } else {
    output = `${baseHeader}${escapedPlan}${baseFooter}`;
  }

  return output;
}

/**
 * Simulates the apply comment building logic (terraform-apply-gcp)
 * This matches the exact logic in actions/terraform-apply-gcp/action.yml
 */
function buildApplyComment(environment, plan, steps, context) {
  // Apply the backtick escaping logic as in the action
  const escapedPlan = plan.replace(/`/g, '\\`');

  const baseHeader = `#### Environment: ${environment}
          #### Terraform Apply 🚀\`${steps.tf_apply.outcome}\`

          <details><summary>Show Plan</summary>

          \`\`\`\n
          `;

  const baseFooter = `
          \`\`\`

          </details>

          *Pusher: @${context.actor}, Action: \`${context.event_name}\`, Working Directory: \`${context.working_dir}\`, Workflow: \`${context.workflow}\`*`;

  const baseLength = baseHeader.length + baseFooter.length;
  let output;

  // Check if comment exceeds GitHub's limit and truncate if necessary
  if (baseLength + escapedPlan.length > MAX_COMMENT_LENGTH) {
    const availableForPlan = MAX_COMMENT_LENGTH - baseLength;
    const truncationNotice = `\n\n... [Plan truncated - showing first ${availableForPlan} characters only. See workflow logs for full output.] ...`;
    const maxPlanLength = availableForPlan - truncationNotice.length;

    if (maxPlanLength > 0) {
      const truncatedPlan = escapedPlan.substring(0, maxPlanLength) + truncationNotice;
      output = `${baseHeader}${truncatedPlan}${baseFooter}`;
    } else {
      output = `#### Environment: ${environment}

              #### Terraform Apply 🚀\`${steps.tf_apply.outcome}\`

              Plan output is too large to display. Please check the workflow logs for the full plan.

              *Pusher: @${context.actor}, Action: \`${context.event_name}\`, Working Directory: \`${context.working_dir}\`, Workflow: \`${context.workflow}\`*`;
    }
  } else {
    output = `${baseHeader}${escapedPlan}${baseFooter}`;
  }

  return output;
}

// Test cases
function runTests() {
  console.log('Running comment length validation tests...\n');

  const mockSteps = {
    fmt: { outcome: 'success' },
    init: { outcome: 'success' },
    validate: { outcome: 'success' },
    plan: { outcome: 'success' },
    tf_apply: { outcome: 'success' }
  };

  const mockContext = {
    actor: 'test-user',
    event_name: 'pull_request',
    working_dir: 'environments/dev',
    workflow: 'terraform-plan'
  };

  let passed = 0;
  let failed = 0;

  // Test 1: Small plan (should not truncate)
  try {
    console.log('Test 1: Small plan (should not truncate)');
    const smallPlan = '+ resource "aws_instance" "test" {\n  + ami = "ami-12345"\n}';
    const comment = buildPlanComment('DEV', 'Validation successful', smallPlan, mockSteps, mockContext);
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

  // Test 2: Large plan (should truncate)
  try {
    console.log('Test 2: Large plan (should truncate)');
    const largePlan = '+ resource "aws_instance" "test" {\n' + '+'.repeat(70000) + '\n}';
    const comment = buildPlanComment('DEV', 'Validation successful', largePlan, mockSteps, mockContext);
    assert.strictEqual(comment.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${comment.length} > ${MAX_COMMENT_LENGTH}`);
    assert.strictEqual(comment.includes('truncated'), true, 'Should include truncation notice');
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  // Test 3: Extremely large plan (should truncate, not minimal message)
  try {
    console.log('Test 3: Extremely large plan (should truncate with notice)');
    const hugePlan = '+'.repeat(200000);
    const comment = buildPlanComment('DEV', 'Validation successful', hugePlan, mockSteps, mockContext);
    assert.strictEqual(comment.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${comment.length} > ${MAX_COMMENT_LENGTH}`);
    assert.strictEqual(comment.includes('truncated'), true, 'Should include truncation notice');
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  // Test 3b: Massive validation output (should show minimal message)
  try {
    console.log('Test 3b: Massive validation output (should show minimal message)');
    // Need validation output so large that baseLength + truncationNotice > MAX_COMMENT_LENGTH
    const massiveValidationOutput = 'x'.repeat(65000);
    const largePlan = '+'.repeat(1000);
    const comment = buildPlanComment('DEV', massiveValidationOutput, largePlan, mockSteps, mockContext);
    assert.strictEqual(comment.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${comment.length} > ${MAX_COMMENT_LENGTH}`);
    assert.strictEqual(comment.includes('too large to display'), true, 'Should show minimal message when base is too large');
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  // Test 4: Apply comment with small plan
  try {
    console.log('Test 4: Apply comment with small plan');
    const smallPlan = '+ resource "aws_instance" "test" {\n  + ami = "ami-12345"\n}';
    const comment = buildApplyComment('PROD', smallPlan, mockSteps, mockContext);
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

  // Test 5: Apply comment with large plan
  try {
    console.log('Test 5: Apply comment with large plan');
    const largePlan = '+ resource "aws_instance" "test" {\n' + '+'.repeat(70000) + '\n}';
    const comment = buildApplyComment('PROD', largePlan, mockSteps, mockContext);
    assert.strictEqual(comment.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${comment.length} > ${MAX_COMMENT_LENGTH}`);
    assert.strictEqual(comment.includes('truncated'), true, 'Should include truncation notice');
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  // Test 6: Boundary test - plan at exact limit
  try {
    console.log('Test 6: Boundary test - plan at exact limit');
    const baseSize = 500; // Approximate size of template without plan
    const planAtLimit = 'x'.repeat(MAX_COMMENT_LENGTH - baseSize - 100);
    const comment = buildPlanComment('DEV', 'Validation successful', planAtLimit, mockSteps, mockContext);
    assert.strictEqual(comment.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${comment.length} > ${MAX_COMMENT_LENGTH}`);
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  // Test 7: Plan right at the boundary (no truncation needed)
  try {
    console.log('Test 7: Plan right at the boundary (no truncation needed)');
    const baseHeader = `#### Environment: DEV
          #### Terraform Format and Style 🖌\`success\`
          #### Terraform Initialization ⚙️\`success\`
          #### Terraform Validation 🤖\`success\`
          <details><summary>Validation Output</summary>

          \`\`\`\n
          Validation successful
          \`\`\`

          </details>

          #### Terraform Plan 📖\`success\`

          <details><summary>Show Plan</summary>

          \`\`\`\n
          `;

    const baseFooter = `
          \`\`\`

          </details>

          *Pusher: @test-user, Action: \`pull_request\`, Working Directory: \`environments/dev\`, Workflow: \`terraform-plan\`*`;

    const baseLength = baseHeader.length + baseFooter.length;
    const planExactlyAtLimit = 'x'.repeat(MAX_COMMENT_LENGTH - baseLength);
    const comment = buildPlanComment('DEV', 'Validation successful', planExactlyAtLimit, mockSteps, mockContext);
    assert.strictEqual(comment.length <= MAX_COMMENT_LENGTH, true, `Should be within limit: ${comment.length} > ${MAX_COMMENT_LENGTH}`);
    assert.strictEqual(comment.includes('truncated'), false, 'Should not truncate when fits');
    console.log(`   Comment length: ${comment.length} chars (limit: ${MAX_COMMENT_LENGTH})`);
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  // Summary
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
