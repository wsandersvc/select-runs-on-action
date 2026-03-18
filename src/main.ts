import * as core from '@actions/core'
import fs from 'fs'
import yaml from 'js-yaml'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const mapping_path = core.getInput('runs-on-mapping-yaml', {
      required: true
    })
    const repository = core.getInput('repository', { required: true })
    const default_runs_on = core.getInput('default-runs-on', { required: true })

    core.info(`Loading runs-on-mapping-yaml from ${mapping_path}`)
    const file_content = await fs.promises
      .readFile(mapping_path, 'utf-8')
      .catch((error) => {
        const message = `Failed to read mapping file: ${mapping_path}`
        core.error(message)
        throw new Error(message, { cause: error.cause })
      })

    // throws YAMLException on failure
    const mapping_yaml = yaml.load(file_content) as {
      [runs_on: string]: string[]
    }

    // Debug logs are only output if the `ACTIONS_STEP_DEBUG` secret is true
    core.debug(`mapping_yaml type: ${typeof mapping_yaml}`)
    core.debug(`mapping_yaml keys: ${Object.keys(mapping_yaml)}`)
    core.debug(`mapping_yaml schema: ${JSON.stringify(mapping_yaml, null, 2)}`)

    let runs_on = default_runs_on
    for (const [key, repositories] of Object.entries(mapping_yaml)) {
      // validate runs-on key contains an array
      if (!Array.isArray(repositories)) {
        core.warning(`Skipping key "${key}": value is not an array`)
        continue
      }

      if (repositories.includes(repository)) {
        runs_on = key
        core.info(`Found repository "${repository}" in runs_on group: ${key}`)
        break
      }
    }

    // Set outputs for other workflow steps to use
    core.setOutput('runs_on', runs_on)
  } catch (error) {
    // Fail the workflow run if an error occurs
    core.debug(JSON.stringify(error, null, 2))
    const message =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    core.setFailed(message)
  }
}
