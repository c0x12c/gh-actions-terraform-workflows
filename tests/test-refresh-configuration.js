#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readAction(actionPath) {
  return fs.readFileSync(path.join(ROOT, actionPath), 'utf8');
}

function assertHasRefreshInput(actionPath, expectedDescriptionFragment) {
  const action = readAction(actionPath);

  assert.match(action, /^  refresh:\n/m, `${actionPath} should define a refresh input`);
  assert.match(
    action,
    new RegExp(`description: "${expectedDescriptionFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    `${actionPath} should describe what refresh controls`,
  );
  assert.match(action, /required: false\n    default: "true"/, `${actionPath} should default refresh to true`);
}

function assertTerraformCommandUsesRefresh(actionPath, command) {
  const action = readAction(actionPath);

  assert.match(
    action,
    new RegExp(`${command}[^\\n]*-refresh=\\$\\{\\{ inputs\\.refresh \\}\\}`),
    `${actionPath} should pass inputs.refresh to terraform ${command}`,
  );
}

function runTests() {
  console.log('Running refresh configuration tests...\n');

  assertHasRefreshInput('actions/terraform-plan/action.yml', 'Whether to refresh the state before planning');
  assertTerraformCommandUsesRefresh('actions/terraform-plan/action.yml', 'terraform plan');

  assertHasRefreshInput('actions/terraform-plan-gcp/action.yml', 'Whether to refresh the state before planning');
  assertTerraformCommandUsesRefresh('actions/terraform-plan-gcp/action.yml', 'terraform plan');

  assertHasRefreshInput('actions/terraform-apply/action.yml', 'Whether to refresh the state before applying');
  assertTerraformCommandUsesRefresh('actions/terraform-apply/action.yml', 'terraform apply');

  assertHasRefreshInput('actions/terraform-apply-gcp/action.yml', 'Whether to refresh the state before applying');
  assertTerraformCommandUsesRefresh('actions/terraform-apply-gcp/action.yml', 'terraform plan');
  assertTerraformCommandUsesRefresh('actions/terraform-apply-gcp/action.yml', 'terraform apply');

  console.log('All refresh configuration tests passed.');
}

runTests();
