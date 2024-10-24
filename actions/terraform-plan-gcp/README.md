# Generalized Terraform Plan Workflow on GCP

This GitHub Workflow action is designed to create a reusable method for running Terraform plan within any GCP environment. It's capable of configuring GCP credentials and posts comments to pull requests when appropriate.

## Inputs

Here are the required inputs for the workflow:

| Input Name                       | Description                                       | Required | Default |
|----------------------------------|---------------------------------------------------|----------|---------|
| `gcp_project_id`                 | GCP Project ID to use                             | `true`   |         |
| `gcp_service_account`            | The GCP Service Account to use for authentication | `true`   |         |
| `gcp_workload_identity_provider` | The GCP Workload Identity Provider to use         | `true`   |         |
| `environment`                    | The environment to use (e.g., `dev`, `prod`)      | `true`   |         |
| `github_token`                   | GitHub Token to post comments to PR               | `true`   |         |
| `python_version`                 | The Python version to use                         | `false`  | `3.12`  |
| `secret_filter`                  | The filter name to use with git-secret-protector  | `false`  | `''`    |
| `terraform_version`              | The Terraform version to use                      | `false`  | `1.8.4` |
| `working_dir`                    | Working directory for Terraform files             | `true`   |         |

## Usage

Here is an example of how to use this workflow in your GitHub actions:

```
steps:
  - name: Run Terraform Plan
    uses: c0x12c/gh-actions-terraform-workflows/actions/terraform-plan@v1
    with:
      gcp_project_id: 'my-project-id'
      gcp_service_account: 'my-service-account
      gcp_workload_identity_provider: 'my-workload-identity-provider'
      github_token: 'github-token'
      environment: 'dev'
      python_version: '3.12'
      secret_filter: 'my-secret-filter'
      terraform_version: '1.8.4'
      working_dir: './terraform'
```

Add sample for Terraform Plan workflow
