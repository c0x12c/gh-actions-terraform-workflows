#!/usr/bin/env node

/**
 * Unit test for backtick escaping in Terraform plan/apply comments
 * Tests that backticks in the plan/validation output are correctly escaped 
 * with a backslash to prevent breaking the Markdown comment structure.
 * 
 * Usage: node tools/test-backtick-escaping.js
 */

const assert = require('assert');

/**
 * Simulates the comment building logic from the GitHub Action (terraform-plan)
 * This includes the backtick escaping fix.
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

  return `${baseHeader}${escapedPlan}${baseFooter}`;
}

// Test cases
function runTests() {
  console.log('Running backtick escaping tests...\n');

  const mockSteps = {
    fmt: { outcome: 'success' },
    init: { outcome: 'success' },
    validate: { outcome: 'success' },
    plan: { outcome: 'success' }
  };

  const mockContext = {
    actor: 'test-user',
    event_name: 'pull_request',
    working_dir: 'environments/dev',
    workflow: 'terraform-plan'
  };

  let passed = 0;
  let failed = 0;

  // Test 1: Plan with inline backticks
  try {
    console.log('Test 1: Plan with inline backticks');
    const planWithBackticks = 'resource "aws_instance" "test" {\n  name = "my-`backtick`-instance"\n}';
    const comment = buildPlanComment('DEV', 'Validation successful', planWithBackticks, mockSteps, mockContext);
    
    // Check if the backtick in the plan is escaped
    assert.strictEqual(comment.includes('my-\\`backtick\\`-instance'), true, 'Backticks should be escaped with backslash');
    
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  // Test 2: Plan with triple backticks (potential Markdown break)
  try {
    console.log('Test 2: Plan with triple backticks');
    const planWithTripleBackticks = 'Some plan text\n```\nmore text\n```';
    const comment = buildPlanComment('DEV', 'Validation successful', planWithTripleBackticks, mockSteps, mockContext);
    
    // Each backtick in the triple backticks should be escaped
    assert.strictEqual(comment.includes('\\`\\`\\`'), true, 'Triple backticks should be escaped to prevent ending the code block');
    
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  // Test 3: Validation output with backticks
  try {
    console.log('Test 3: Validation output with backticks');
    const validationWithBackticks = 'Error: `something` went wrong during validation';
    const comment = buildPlanComment('DEV', validationWithBackticks, 'Plan is ok', mockSteps, mockContext);
    
    // Check if backticks in validation output are escaped
    assert.strictEqual(comment.includes('Error: \\`something\\` went wrong'), true, 'Backticks in validation output should be escaped');
    
    console.log('✓ PASSED\n');
    passed++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message}\n`);
    failed++;
  }

  // Test 4: Verify template backticks are intact
  try {
    console.log('Test 4: Verify template backticks (code blocks) are intact');
    const comment = buildPlanComment('DEV', 'Validation successful', 'Plan content', mockSteps, mockContext);
    
    // The triple backticks used for Markdown code blocks in the template itself 
    // are not part of the content being escaped, so they should remain as triple backticks
    // in the final output (not escaped by the logic we added).
    const codeBlockCount = (comment.match(/```/g) || []).length;
    assert.strictEqual(codeBlockCount >= 4, true, 'Should have at least 4 triple backtick sequences (2 for validation, 2 for plan)');
    
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
