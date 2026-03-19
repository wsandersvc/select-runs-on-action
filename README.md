# select-runs-on-action

![Linter](https://github.com/wsandersvc/select-runs-on-action/actions/workflows/linter.yml/badge.svg)
![CI](https://github.com/wsandersvc/select-runs-on-action/actions/workflows/ci.yml/badge.svg)
![Check dist/](https://github.com/wsandersvc/select-runs-on-action/actions/workflows/check-dist.yml/badge.svg)
![CodeQL](https://github.com/wsandersvc/select-runs-on-action/actions/workflows/codeql-analysis.yml/badge.svg)
![Coverage](./badges/coverage.svg)

## Roadmap

## Initial Setup

1. Create the file `runs-on-mapping.yaml` in your `veracode` or configuration
   repository.
   - Ensure the format is correct.

## Modify Veracode Workflow App

```yaml
runs_on_validations:
  needs: validations
  runs-on:
    ${{ fromJson(github.event.client_payload.user_config.default_runs_on) }}
  name: Runner Validations
  outputs:
    override_runs_on: ${{ steps.select-runs-on-action.outputs.runs-on }}
  steps:
    - name: Verify Runner Mappings
      id: select-runs-on-action
      uses: wsandersvc/select-runs-on-action@v1
      with:
        github-token: ${{ github.event.client_payload.token }}
        owner: ${{ github.event.client_payload.repository.owner }}
        repository: ${{ github.event.client_payload.repository.name }}
        default-runs-on:
          ${{ github.event.client_payload.user_config.default_runs_on }}
        runs-on-mapping-yaml: runs-on-mapping.yaml
```

Optionally define the following if the mapping yaml file resides in a custom
location.

```yaml
with:
  config-repository: my-custom-repository
```
