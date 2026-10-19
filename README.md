# gh-actions-terraform-workflows

This repository provides a collection of reusable composite GitHub Actions for managing Terraform operations (`plan`, `apply`, etc.) across different environments (`dev`, `prod`, `stage`, etc.). These actions are designed to integrate with AWS and securely manage secrets.

## Version Warning

`v1.1.4` changed the AWS `terraform-apply` action from always running with `-refresh=false` to using the `refresh` input with a default of `true`; the GCP apply action also defaults `refresh` to `true` in the current `v1` line. Because `v1` is a moving tag, workflows using `@v1` may already run apply with refresh enabled.

If your workflows rely on the old no-refresh behavior, set `refresh: 'false'` explicitly or pin to `v1.1.3` while you review the migration. Use `@v2` for the major release where plan and apply actions expose the same refresh configuration.

## Available Composite Actions

### 1. `pull-request` (Terraform Plan)
The `pull-request` composite action runs `terraform plan` for the specified environment. It sets up AWS credentials, manages environment-specific secrets, and performs Terraform actions such as formatting, validation, and planning.

#### Inputs

| Input Name          | Description                                  | Required | Default  |
|---------------------|----------------------------------------------|----------|----------|
| `app-id`            | GitHub App ID                                | `true`   |          |
| `aws-region`        | AWS region to use (e.g., `us-west-2`)        | `true`   |          |
| `aws-role`          | The AWS role to assume for the environment   | `true`   |          |
| `environment`       | The environment to use (e.g., `dev`, `prod`) | `true`   |          |
| `private-key`       | GitHub App Private Key                       | `true`   |          |
| `python-version`    | Python version to use                        | `false`  | `3.12`   |
| `terraform-version` | Terraform version to use                     | `false`  | `1.8.4`  |
| `working-dir`       | The working directory for Terraform files    | `true`   |          |

#### Example Usage

```yaml
jobs:
  terraform-plan:
    runs-on: ubuntu-latest
    steps:
      - name: Run Terraform Plan
        uses: your-username/gh-actions-terraform-workflows/.github/actions/pull-request@v1.0.0
        with:
          app-id: ${{ secrets.GITHUB_APP_ID }}
          aws-region: ${{ secrets.AWS_REGION }}
          aws-role: ${{ secrets.AWS_ROLE_TO_ASSUME_DEV }}
          environment: dev
          private-key: ${{ secrets.GH_APP_PRIVATE_KEY }}
          python-version: "3.12"
          terraform-version: "1.8.4"
          working-dir: terraform/environments/dev

## Reusable Workflows

### `terraform-apply-approval.yml` (gated apply without GitHub Environments)

Plan, then an approval **issue**, then apply. Use it when the repo cannot gate with an Environment:
required reviewers on a private repo need GitHub Enterprise. With Enterprise, use an Environment
instead. That rule is enforced outside the ref, and this gate is not.

```yaml
# .github/workflows/apply-prod.yml
name: PROD - Terraform Apply

on:
  push:
    tags: ['v*.*.*']

# One apply per state. Never cancel an in-flight apply.
concurrency:
  group: tf-apply-prod
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write
  issues: read

jobs:
  apply:
    uses: c0x12c/gh-actions-terraform-workflows/.github/workflows/terraform-apply-approval.yml@v3
    with:
      environment: prod
      working_dir: environment/prod/us-west-2
      aws_region: ${{ vars.AWS_REGION }}
      approver_teams: sre,leads
      app_id: ${{ vars.GH_APP_ID }}
    secrets:
      aws_role: ${{ secrets.AWS_ROLE_TO_ASSUME_PROD }}
      gh_app_private_key: ${{ secrets.GH_APP_PRIVATE_KEY }}
      slack_webhook_url: ${{ secrets.SLACK_WEBHOOK_URL }}
```

| Input | Description | Required | Default |
|---|---|---|---|
| `environment` | Terraform env name, used in titles and notifications | `true` | |
| `working_dir` | Terraform root to plan and apply | `true` | |
| `aws_region` | AWS region for the assumed role | `true` | |
| `approver_teams` | Comma-separated org team slugs; one member's approval is enough | `true` | |
| `app_id` | GitHub App with org Members: read and repo Issues: read & write | `true` | |
| `runs_on` | Runner for plan and apply (the gate always uses `ubuntu-latest`) | `false` | `ubuntu-latest` |
| `terraform_version` | Terraform version | `false` | `1.8.4` |
| `refresh` | Refresh state in plan and apply | `false` | `true` |
| `secret_filter` | git-secret-protector filter; empty skips decryption (needed on runners without Docker) | `false` | `""` |
| `approval_timeout_minutes` | How long the issue waits, 1-55 | `false` | `45` |

Secrets: `aws_role` and `gh_app_private_key` are required. `slack_webhook_url` is optional, and
leaving it unset turns off every notification.

To approve, comment exactly `approved`, `approve`, `lgtm` or `yes` on the issue. To deny, comment
`denied`, `deny` or `no`. Anything else is ignored.

Kept in the caller: the trigger, `concurrency`, `permissions`, and, if you want it, a
`workflow_run` notice for runs cancelled while queued. Those never start a job inside the called
workflow.

**Limits:**
- **Advisory.** A tag whose workflow drops the call applies unreviewed.
- **Self-approval.** `exclude-workflow-initiator-as-approver` excludes `github.actor`. When an App
  pushes the tag, the releaser can approve their own apply, so this is not four-eyes review.
- **Apply re-plans.** No plan file crosses the gate. The apply job re-plans and refuses to apply
  when the summary line (`Plan: N to add, ...`) differs from the approved one. Drift that keeps
  the same counts still gets through.
