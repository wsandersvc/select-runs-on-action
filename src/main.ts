import * as core from '@actions/core'
import { getOctokit } from '@actions/github'
import yaml from 'js-yaml'

interface FetchFileOptions {
  owner: string
  repository: string
  path: string
  ref?: string
  token: string
}

async function fetchFileFromRepo(options: FetchFileOptions): Promise<string> {
  const { owner, repository, path, ref, token } = options

  try {
    const octokit = getOctokit(token)

    core.info(
      `Fetching file: ${path} from ${owner}/${repository}${ref ? ` (ref: ${ref})` : ''}`
    )

    const response = await octokit.rest.repos.getContent({
      owner,
      repo: repository,
      path,
      ...(ref && { ref })
    })

    if (!('content' in response.data) || Array.isArray(response.data)) {
      throw new Error(`Path ${path} is not a file`)
    }

    const content = Buffer.from(response.data.content, 'base64').toString(
      'utf-8'
    )

    core.info(`Successfully fetched file (${response.data.size} bytes)`)
    return content
  } catch (error) {
    if (error instanceof Error) {
      core.error(`Failed to fetch file: ${error.message}`)
      throw new Error(
        `Failed to fetch ${path} from ${owner}/${repository}: ${error.message}`,
        { cause: error }
      )
    }
    throw new Error('Unknown error', { cause: error })
  }
}
export const test = {
  fetchFileFromRepo
}

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
    const github_token = core.getInput('github-token', { required: true })
    const owner = core.getInput('owner', { required: true })
    const repository = core.getInput('repository', { required: true })
    const config_repository = core.getInput('config-repository', {
      required: false
    })
    const ref = core.getInput('ref')
    const default_runs_on = core.getInput('default-runs-on', { required: true })

    core.info(`Loading runs-on-mapping-yaml from ${mapping_path}`)
    const file_content = await fetchFileFromRepo({
      owner: owner,
      repository: config_repository,
      path: mapping_path,
      ref,
      token: github_token
    }).catch((error) => {
      const message = `Failed to fetch mapping file from ${owner}/${config_repository}/${mapping_path}`
      core.error(message)
      throw new Error(message, { cause: error })
    })

    // throws YAMLException on failure
    const mapping_yaml = yaml.load(file_content) as {
      [runs_on: string]: string[]
    }

    // Debug logs are only output if the `ACTIONS_STEP_DEBUG` secret is true
    core.debug(`mapping_yaml type: ${typeof mapping_yaml}`)
    core.debug(`mapping_yaml keys: ${Object.keys(mapping_yaml)}`)
    core.debug(`mapping_yaml schema: ${JSON.stringify(mapping_yaml, null, 2)}`)

    let runs_on = JSON.parse(default_runs_on.replace(/'/g, '"'))[0]
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

    core.info(`Using runs_on value: ${runs_on}`)

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
