# Generalized Terraform Apply GitHub Workflow Action

This GitHub workflow action is designed to create a reusable method for running Terraform Apply within any GCP environment. After it performs the apply, it sends a notification to Slack.

## Inputs

Here are the inputs the workflow requires:

| Input Name                       | Description                                                | Required | Default |
|----------------------------------|------------------------------------------------------------|----------|---------|
| `gcp_project_id`                 | GCP Project ID to use                                      | `true`   |         |
| `gcp_service_account`            | The GCP Service Account to use for authentication          | `true`   |         |
| `gcp_workload_identity_provider` | The GCP Workload Identity Provider to use                  | `true`   |         |
| `environment`                    | The environment to use (e.g., `dev`, `prod`)               | `true`   |         |
| `python_version`                 | Python version to use                                      | `false`  | `3.12`  |
| `secret_filter`                  | The filter name to use with git-secret-protector           | `false`  | `''`    |
| `slack_webhook_url`              | The Slack Webhook URL for posting deployment notifications | `false`  | `''`    |
| `terraform_version`              | Terraform version to use                                   | `false`  | `1.8.4` |
| `working_dir`                    | The working directory for Terraform files                  | `true`   |         |

## Usage

```
steps:
  - name: Run Terraform Apply
    uses: c0x12c/gh-actions-terraform-workflows/actions/terraform-apply-gcp@v1
    with:
      gcp_project_id: 'my-project-id'
      gcp_service_account: 'my-service-account'
      gcp_workload_identity_provider: 'my-workload-identity-provider'
      environment: 'prod'
      python_version: '3.9'
      secret_filter: 'my-secret-filter'
      slack_webhook_url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX'
      terraform_version: '0.14.5'
      working_dir: './terraform'
```
