# Azure hosting with Terraform

These files adopt the existing Focus Studio hosting in the Azure for Students
subscription. They manage `focus-studio-rg`, its **Free F1 Linux plan**, and the
Python 3.12 Web App `focus-studio-tate`. The existing GitHub Actions workflow
continues to deploy the application code.

The app runs at:
<https://focus-studio-tate-fscpb3dud3ara9bj.swedencentral-01.azurewebsites.net>

## On this computer

Terraform's local state is `infra/terraform.tfstate`. It is private and excluded
from Git. Keep it and its backup on this computer; do not upload them to GitHub.
The `.terraform.lock.hcl` file is intentionally committed.

## Use from a fresh checkout

Install Terraform 1.5 or later and Microsoft's Azure CLI, then open a terminal
in this `infra` folder. Sign in with your Azure for Students account using the normal browser
login; the university may block device-code login.

```sh
az login --tenant 79c742c4-e61c-4fa5-be89-a3cb566a80d1
terraform init
terraform plan -out=adopt.tfplan
```

For the first import, review the plan. It should show **3 to import, 0 to add,
0 to change, 0 to destroy**. If it shows resource changes, resolve those before
applying. Then run:

```sh
terraform apply adopt.tfplan
terraform plan
```

The last command should report **No changes**. The import blocks can stay in
the repository; Terraform skips them once the resources are in its state.

## Future changes

Edit the `.tf` files and run `terraform plan` to preview infrastructure changes.
Review the plan before applying. Ordinary timer changes still belong in the
app files and are deployed through GitHub Actions.

The resource group retains its original metadata location, `centralus`. The
hosting plan and app are in `swedencentral`, an allowed region for this student
subscription. Do not move the resources by changing their location fields.

All three resources have `prevent_destroy` enabled. There are no Terraform
automation workflows that apply changes without review. The existing deployment
identity and GitHub trust configuration stay managed by Azure Deployment Center.

For collaboration or automated Terraform deployment, migrate the local state to
a private, access-controlled remote backend first. Do not pass state between
people through a public repository.
