# Generalized Terraform Apply GitHub Workflow Action

This GitHub workflow action is a reusable Terraform apply script designed to work in any environment. After it performs the apply, it sends a notification to Slack.

## Inputs

Here are the inputs the workflow requires:

| Input Name          | Description                                               | Required | Default |
|---------------------|-----------------------------------------------------------|----------|---------|
| `aws_region`        | AWS region to use                                         | `true`   |         |
| `aws_role`          | The AWS role to assume for the environment                | `true`   |         |
| `environment`       | The environment to use (e.g., `dev`, `prod`)              | `true`   |         |
| `python_version`    | Python version to use                                     | `false`  | `3.12`  |
| `secret_filter`     | The filter name to use with git-secret-protector          | `false`  | `''`    |
| `slack_webhook_url` | The Slack Webhook URL for posting deployment notifications| `true`   |         |
| `terraform_version` | Terraform version to use                                  | `false`  | `1.8.4` |
| `working_dir`       | The working directory for Terraform files                 | `true`   |         |

## Usage

```
steps:
  - name: Run Terraform Apply
    uses: Generalized-Terraform-Apply-Workflow@v1
    with:
      aws_region: 'us-east-1'
      aws_role: 'arn:aws:iam::123456789012:role/my-role'
      environment: 'prod'
      python_version: '3.9'
      secret_filter: 'my-secret-filter'
      slack_webhook_url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX'
      terraform_version: '0.14.5'
      working_dir: './terraform'
```