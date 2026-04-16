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
