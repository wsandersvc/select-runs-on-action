import * as core from '@actions/core'
import { getOctokit } from '@actions/github'
import yaml, { FAILSAFE_SCHEMA } from 'js-yaml'

type Octokit = ReturnType<typeof getOctokit>

interface RunnerMapping {
  [runnerName: string]: string[]
}

interface RunsOnMapping {
  'build-runs-on'?: RunnerMapping
  'default-runs-on'?: RunnerMapping
}

/**
 * Parses the GitHub Actions default-runs-on input format.
 *
 * GitHub Actions passes runner arrays with single quotes (e.g., "[ 'ubuntu-latest' ]")
 * which is not valid JSON. This function normalizes the format by replacing single
 * quotes with double quotes and validates that the input contains exactly one runner.
 *
 * @param input - String in the format "[ 'runner-name' ]" with single quotes
 * @returns The runner name extracted from the array as a string
 * @throws {Error} If the format is invalid, not an array, doesn't contain exactly 1 element, or element is not a string
 *
 * @example
 * parseDefaultRunsOn("[ 'ubuntu-latest' ]")  // Returns: "ubuntu-latest"
 * parseDefaultRunsOn("[ 'windows-latest' ]") // Returns: "windows-latest"
 */
function parseRunsOn(input: string): string {
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
    throw new Error(`Invalid runs-on-format ${(error as Error).message}`, {
      cause: error
    })
  }
}

/**
 * Fetches a file from a GitHub repository using the GitHub API.
 *
 * This function retrieves file content from a specified repository and path,
 * validates that the path points to a file (not a directory), checks rate limits,
 * and decodes the base64-encoded content returned by the GitHub API.
 *
 * @param options - Configuration object containing repository details
 * @param options.owner - GitHub repository owner (username or organization)
 * @param options.repository - GitHub repository name where the file is located
 * @param options.path - Path to the file within the repository
 * @param options.ref - Optional git reference (branch, tag, or commit SHA). If not provided, uses default branch
 * @param octokit - Authenticated Octokit instance for making GitHub API calls
 * @returns Promise that resolves to the decoded file content as a UTF-8 string
 * @throws {Error} If the file cannot be fetched, the path is a directory, or API call fails
 *
 * @example
 * const content = await fetchFileFromRepo(
 *   { owner: 'myorg', repository: 'config', path: 'runners.yaml', ref: 'main' },
 *   octokit
 * )
 */
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
    // Check rate limit
    const rateLimit = await octokit.rest.rateLimit.get()
    core.debug(
      `Rate limit remaining: ${rateLimit.data.rate.remaining}/${rateLimit.data.rate.limit}`
    )
    core.debug(`Rate limit reset: ${rateLimit.data.rate.reset}`)

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

/**
 * Validates the structure and content of the runs-on mapping YAML data.
 *
 * This function performs runtime validation of the parsed YAML data to ensure
 * it matches 'build-runs-on' and 'default-runs-on'
 * top-level keys, each containing runner mappings. It gracefully handles invalid
 * entries by warning about them and continuing validation.
 *
 * @param data - Parsed YAML data of unknown type (for safety)
 * @returns Validated mapping object with optional build-runs-on and default-runs-on sections
 * @throws {Error} If data structure is invalid
 *
 * @example
 * const mapping = validateMapping({
 *   'build-runs-on': {
 *     'ubuntu-latest': ['repo1', 'repo2'],
 *     'windows-latest': ['repo3']
 *   },
 *   'default-runs-on': {
 *     'ubuntu-latest': ['repo4'],
 *     'macos-latest': ['repo5']
 *   }
 * })
 *
 * @example
 * // Only default-runs-on specified
 * const mapping = validateMapping({
 *   'default-runs-on': {
 *     'ubuntu-latest': ['repo1']
 *   }
 * })
 */
function validateMapping(data: unknown): RunsOnMapping {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Mapping YAML must be an object')
  }

  const dataObj = data as Record<string, unknown>
  const result: RunsOnMapping = {}

  // Validate build-runs-on if present
  if ('build-runs-on' in dataObj) {
    result['build-runs-on'] = validateRunnerMapping(
      dataObj['build-runs-on'],
      'build-runs-on'
    )
  }

  // Validate default-runs-on if present
  if ('default-runs-on' in dataObj) {
    result['default-runs-on'] = validateRunnerMapping(
      dataObj['default-runs-on'],
      'default-runs-on'
    )
  }

  // At least one section must be present
  if (!result['build-runs-on'] && !result['default-runs-on']) {
    throw new Error(
      'Mapping YAML must contain at least one of "build-runs-on" or "default-runs-on"'
    )
  }

  return result
}

/**
 * Validates a runner mapping section (helper for validateMapping).
 *
 * @param data - Data to validate as a runner mapping
 * @param sectionName - Name of the section for error messages
 * @returns Validated runner mapping
 * @throws {Error} If data structure is invalid or no valid mappings found
 */
function validateRunnerMapping(
  data: unknown,
  sectionName: string
): RunnerMapping {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`"${sectionName}" must be an object`)
  }

  const validated: RunnerMapping = {}
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value)) {
      core.warning(`Skipping "${sectionName}.${key}": value is not an array`)
      continue
    }

    if (!value.every((item) => typeof item === 'string')) {
      core.warning(
        `Skipping "${sectionName}.${key}": array contains non-string values`
      )
      continue
    }

    validated[key] = value
  }

  if (Object.keys(validated).length === 0) {
    throw new Error(`No valid runner mappings found in "${sectionName}"`)
  }

  return validated
}

/**
 * Selects the appropriate runner for a repository based on the mapping configuration.
 *
 * This function searches through a runner mapping to find which runner group
 * contains the specified repository. If found, it returns that runner name.
 * If not found in any group, it falls back to the default runner.
 *
 * @param mapping - Runner mapping object (runner names to repository lists)
 * @param repository - Name of the repository to find a runner for
 * @param defaultRunner - Fallback runner name to use if repository is not found
 * @param sectionName - Name of section for logging (e.g., 'build-runs-on')
 * @returns The selected runner name (either matched or default)
 *
 * @example
 * const runner = selectRunner(
 *   { 'ubuntu-latest': ['repo1', 'repo2'], 'windows-latest': ['repo3'] },
 *   'repo2',
 *   'ubuntu-latest',
 *   'build-runs-on'
 * )
 * // Returns: 'ubuntu-latest' (found in mapping)
 */
function selectRunner(
  mapping: RunnerMapping | undefined,
  repository: string,
  defaultRunner: string,
  sectionName: string
): string {
  // If no mapping provided, use default
  if (!mapping) {
    core.info(
      `No "${sectionName}" mapping provided, using default: ${defaultRunner}`
    )
    return defaultRunner
  }

  // Search for repository in mapping
  for (const [runnerName, repositories] of Object.entries(mapping)) {
    if (repositories.includes(repository)) {
      core.info(
        `Found repository "${repository}" in ${sectionName}.${runnerName}`
      )
      return runnerName
    }
  }

  // Not found, use default
  core.info(
    `Repository "${repository}" not found in ${sectionName}, using default: ${defaultRunner}`
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
      buildRunsOn: core.getInput('build-runs-on', { required: true }),
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

    // Parse both runner inputs
    const defaultRunnerFallback = parseRunsOn(inputs.defaultRunsOn)
    const buildRunnerFallback = parseRunsOn(inputs.buildRunsOn)

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

    // Select runners for both sections
    const defaultRunner = selectRunner(
      mapping['default-runs-on'],
      inputs.repository,
      defaultRunnerFallback,
      'default-runs-on'
    )

    const buildRunner = selectRunner(
      mapping['build-runs-on'],
      inputs.repository,
      buildRunnerFallback,
      'build-runs-on'
    )

    // Set both outputs
    core.info(`Using default-runs-on value: ${defaultRunner}`)
    core.setOutput('default-runs-on', `['${defaultRunner}']`)

    core.info(`Using build-runs-on value: ${buildRunner}`)
    core.setOutput('build-runs-on', `['${buildRunner}']`)
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}
