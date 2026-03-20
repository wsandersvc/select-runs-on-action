import * as core from '@actions/core'
import { getOctokit } from '@actions/github'
import yaml, { FAILSAFE_SCHEMA } from 'js-yaml'
import { checkRateLimit } from './rate-limiter.js'

export type Octokit = ReturnType<typeof getOctokit>

interface RunsOnMapping {
  [runnerName: string]: string[]
}

function parseDefaultRunsOn(input: string): string {
  try {
    // Add comment explaining why this is needed
    // GitHub Actions passes arrays with single quotes, e.g., "[ 'ubuntu-latest' ]"
    // We need to convert to valid JSON format
    const normalized = input.replace(/'/g, '"')
    const parsed = JSON.parse(normalized)

    if (!Array.isArray(parsed) || parsed.length !== 1) {
      throw new Error('Must be a non-empty array with 1 element')
    }

    if (typeof parsed[0] !== 'string') {
      throw new Error('Array must contain a string')
    }

    return parsed[0]
  } catch (error) {
    throw new Error(
      `Invalid default-runs-on-format ${(error as Error).message}`,
      {
        cause: error
      }
    )
  }
}

async function fetchFileFromRepo(
  options: {
    owner: string
    path: string
    ref: string | undefined
    repository: string
  },
  octokit: Octokit
): Promise<string> {
  const { owner, path, ref, repository } = options

  try {
    // Check rate limit before making API call
    const rateLimitCheck = await checkRateLimit(
      octokit,
      `Fetch ${path} from ${owner}/${repository}`
    )

    // If rate limit is critically low, abort operation
    if (!rateLimitCheck.canProceed) {
      throw new Error(
        `Rate limit exhausted: ${rateLimitCheck.warning}. Cannot fetch file.`
      )
    }

    core.info(
      `Fetching file: ${path} from ${owner}/${repository}${ref ? ` (ref: ${ref})` : ''}`
    )

    const response = await octokit.rest.repos.getContent({
      owner,
      path,
      repo: repository,
      ...(ref && { ref })
    })

    core.debug(JSON.stringify(response, null, 2))

    // Validate API response is valid and for GitHub file, not directory
    if (!('content' in response.data) || Array.isArray(response.data)) {
      throw new Error(
        `Path ${owner}/${repository}/${path}${ref ? ` (ref: ${ref})` : ''} is a directory, not a file`
      )
    }

    const content = Buffer.from(response.data.content, 'base64').toString(
      'utf-8'
    )

    core.info(`Successfully fetched file (${response.data.size} bytes)`)
    return content
  } catch (error) {
    const err = error as Error
    core.error(`Failed to fetch file: ${err.message}`)
    throw new Error(
      `Failed to fetch file from ${owner}/${repository}/${path}: ${err.message}`,
      { cause: error }
    )
  }
}

function validateMapping(data: unknown): RunsOnMapping {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Mapping YAML must be an object')
  }

  const validated: RunsOnMapping = {}
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value)) {
      core.warning(`Skipping key "${key}": value is not an array`)
      continue
    }

    if (!value.every((item) => typeof item === 'string')) {
      core.warning(`Skipping key "${key}": array contains non-string values`)
      continue
    }

    validated[key] = value
  }

  if (Object.keys(validated).length === 0) {
    throw new Error('No valid runner mappings found in YAML file')
  }
  return validated
}

function selectRunner(
  mapping: RunsOnMapping,
  repository: string,
  defaultRunner: string
): string {
  for (const [runnerName, repositories] of Object.entries(mapping)) {
    if (repositories.includes(repository)) {
      core.info(
        `Found repository "${repository}" in runs-on group: ${runnerName}`
      )
      return runnerName
    }
  }
  core.info(
    `Repository "${repository}" not found in mapping, using default: ${defaultRunner}`
  )
  return defaultRunner
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const inputs = {
      configRepository: core.getInput('config-repository', {
        required: false
      }),
      defaultRunsOn: core.getInput('default-runs-on', { required: true }),
      githubToken: core.getInput('github-token', { required: true }),
      mappingPath: core.getInput('runs-on-mapping-yaml', { required: true }),
      owner: core.getInput('owner', { required: true }),
      ref: core.getInput('ref', { required: false }),
      repository: core.getInput('repository', { required: true })
    }

    const octokit = getOctokit(inputs.githubToken)

    const defaultRunner = parseDefaultRunsOn(inputs.defaultRunsOn)

    core.info(
      `Loading runs-on-mapping-yaml from ${inputs.owner}/${inputs.configRepository}/${inputs.mappingPath}${inputs.ref ? ` (ref: ${inputs.ref})` : ''}`
    )
    const fileContent = await fetchFileFromRepo(
      {
        owner: inputs.owner,
        path: inputs.mappingPath,
        ref: inputs.ref || undefined,
        repository: inputs.configRepository
      },
      octokit
    )

    const rawMapping = yaml.load(fileContent, { schema: FAILSAFE_SCHEMA })
    const mapping = validateMapping(rawMapping)
    core.debug(JSON.stringify(mapping, null, 2))

    const selectedRunner = selectRunner(
      mapping,
      inputs.repository,
      defaultRunner
    )

    core.info(`Using runs-on value: ${selectedRunner}`)
    core.setOutput('runs-on', `['${selectedRunner}']`)
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}
