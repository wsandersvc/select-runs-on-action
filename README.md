# select-runs-on-action

![Linter](https://github.com/wsandersvc/select-runs-on-action/actions/workflows/linter.yml/badge.svg)
![CI](https://github.com/wsandersvc/select-runs-on-action/actions/workflows/ci.yml/badge.svg)
![Check dist/](https://github.com/wsandersvc/select-runs-on-action/actions/workflows/check-dist.yml/badge.svg)
![CodeQL](https://github.com/wsandersvc/select-runs-on-action/actions/workflows/codeql-analysis.yml/badge.svg)
![Coverage](./badges/coverage.svg)

## Roadmap

- Changes required to integrate with Veracode Workflow App.

## Initial Setup

1. Create the file `runs-on-mapping.yaml` in your `veracode` or configuration
   repository.
   - Ensure the format is correct.

## Modify Veracode Workflow App

Please see [action.yml](./action.yml) for supported inputs and outputs. You will
need to update the relevant sections for `build_runs_on` and `default_runs_on`
with the following: `${{ needs.runs_on_validations.outputs.override_runs_on }}`
and set the `runs_on_validations` job as a `need` in jobs where the
override_runs_on output is referenced.

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

### Running as a distributed script

Note, that all parameters are required when executing this way.

```yaml
runs_on_validations:
  needs: validations
  runs-on:
    ${{ fromJson(github.event.client_payload.user_config.default_runs_on) }}
  name: Runner Validations
  outputs:
    override_runs_on: ${{ steps.select-runs-on-action.outputs.runs-on }}
  steps:
    - name: Setup Node
      uses: actions/setup-node@v4
      with:
        node-version: 24.14.0

    - name: Checkout
      uses: actions/checkout@v4

    - name: Verify Runner Mappings
      id: select-runs-on-action
      env:
        INPUT_GITHUB-TOKEN: ${{ github.event.client_payload.token }}
        INPUT_OWNER: ${{ github.event.client_payload.repository.owner }}
        INPUT_REPOSITORY: ${{ github.event.client_payload.repository.name }}
        INPUT_CONFIG-REPOSITORY: veracode
        INPUT_DEFAULT-RUNS-ON:
          ${{ github.event.client_payload.user_config.default_runs_on }}
        INPUT_RUNS-ON-MAPPING-YAML: runs-on-mapping.yaml
      run: |
        node scripts/action-select-runs-on-action.js
```

Optionally define the following if the mapping YAML file resides in a custom
location.

```yaml
with:
  config-repository: my-custom-repository
```
