/**
 * Comprehensive unit tests for the action's main functionality, src/main.ts
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

// Mocks should be declared before the module being tested is imported.
const mockOctokit = {
  rest: {
    repos: {
      getContent: jest.fn<
        () => Promise<{
          data:
            | { content: string; size: number }
            | { name: string; type: string }[]
        }>
      >()
    },
    rateLimit: {
      get: jest.fn<
        () => Promise<{
          data: {
            rate: {
              limit: number
              remaining: number
              reset: number
              used: number
            }
          }
        }>
      >()
    }
  }
}

const mockGetOctokit = jest.fn()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => ({
  getOctokit: mockGetOctokit
}))

// The module being tested should be imported dynamically
const { run } = await import('../src/main.js')

const TEST_REPOS = {
  JAVA: 'verademo-java',
  JAVA_MITIGATED: 'verademo-java-mitigated',
  DOTNET: 'verademo-dotnet',
  NETFRAMEWORK: 'verademo-netframework',
  NONEXISTENT: 'invalid-repo'
}

const TEST_RUNNERS = {
  UBUNTU: "[ 'ubuntu-latest' ]",
  WINDOWS: "[ 'windows-latest' ]",
  MACOS: "[ 'macos-latest' ]",
  SELF_HOSTED: "[ 'self-hosted' ]",
  SCALE_SET: "[ 'scale-set' ]"
}

const CONFIG_REPOSITORY = 'veracode'

const VALID_YAML_MAPPING = `ubuntu-latest:
  - verademo-java
  - verademo-java-mitigated
windows-latest:
  - verademo-dotnet
  - verademo-netframework
`

describe('main.ts', () => {
  const defaultInput: Record<string, string> = {
    'config-repository': CONFIG_REPOSITORY,
    'default-runs-on': TEST_RUNNERS.UBUNTU,
    'github-token': 'test-token',
    owner: 'test-owner',
    repository: TEST_REPOS.JAVA,
    'runs-on-mapping-yaml': 'runs-on-mapping.yaml'
  }

  const setupInput = (override: Record<string, string> = {}) => {
    core.getInput.mockImplementation((name: string) => {
      const inputs = { ...defaultInput, ...override }
      return inputs[name] || ''
    })
  }

  const setupValidMocks = () => {
    // Set up rate limit mock
    mockOctokit.rest.rateLimit.get.mockResolvedValue({
      data: {
        rate: {
          limit: 5000,
          remaining: 4999,
          reset: Math.floor(Date.now() / 1000) + 3600,
          used: 1
        }
      }
    })

    // Set up file content mock
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(VALID_YAML_MAPPING).toString('base64'),
        size: VALID_YAML_MAPPING.length
      }
    })

    mockGetOctokit.mockReturnValue(mockOctokit)
  }

  beforeEach(() => {
    setupInput()
    setupValidMocks()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('Basic Functionality', () => {
    it('should successfully fetch a file from a repository with all required parameters', async () => {
      await run()

      expect(mockGetOctokit).toHaveBeenCalledWith('test-token')
      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
        owner: defaultInput['owner'],
        path: defaultInput['runs-on-mapping-yaml'],
        repo: defaultInput['config-repository']
      })

      expect(core.info).toHaveBeenCalledWith(
        `Fetching file: ${defaultInput['runs-on-mapping-yaml']} from ${defaultInput['owner']}/${defaultInput['config-repository']}`
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringMatching(/Successfully fetched file \(\d+ bytes\)/)
      )
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should successfully fetch a file with an optional ref parameter', async () => {
      const ref = 'main'
      setupInput({ ref })

      await run()

      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
        path: defaultInput['runs-on-mapping-yaml'],
        owner: defaultInput['owner'],
        ref,
        repo: defaultInput['config-repository']
      })

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(`(ref: ${ref})`)
      )
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should successfully handle different branch refs', async () => {
      const branches = ['develop', 'feature/new-runners', 'release/v1.0']

      for (const branch of branches) {
        jest.clearAllMocks()
        setupInput({ ref: branch })
        setupValidMocks()

        await run()

        expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith(
          expect.objectContaining({ ref: branch })
        )
      }

      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should successfully handle commit SHA as ref', async () => {
      const commitSha = 'abc123def456'
      setupInput({ ref: commitSha })

      await run()

      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith(
        expect.objectContaining({ ref: commitSha })
      )

      expect(core.setFailed).not.toHaveBeenCalled()
    })
  })

  describe('Input Validation', () => {
    it('should successfully retrieve all required inputs', async () => {
      await run()

      expect(core.getInput).toHaveBeenCalledWith('default-runs-on', {
        required: true
      })
      expect(core.getInput).toHaveBeenCalledWith('github-token', {
        required: true
      })
      expect(core.getInput).toHaveBeenCalledWith('owner', { required: true })
      expect(core.getInput).toHaveBeenCalledWith('repository', {
        required: true
      })
      expect(core.getInput).toHaveBeenCalledWith('runs-on-mapping-yaml', {
        required: true
      })

      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should successfully retrieve optional inputs', async () => {
      await run()

      expect(core.getInput).toHaveBeenCalledWith('config-repository', {
        required: false
      })
      expect(core.getInput).toHaveBeenCalledWith('ref', { required: false })

      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should use default config-repository when not provided', async () => {
      // Don't set config-repository, let it use the default from action.yml
      // In the mock, we need to return the default value
      const inputWithDefault = { ...defaultInput }
      delete inputWithDefault['config-repository']

      core.getInput.mockImplementation((name: string) => {
        if (name === 'config-repository') {
          return 'veracode' // Simulate the default from action.yml
        }
        return inputWithDefault[name] || ''
      })

      await run()

      // Should use the default 'veracode' repository
      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: defaultInput['owner'],
          repo: 'veracode'
        })
      )
    })
  })

  describe('Default Runs-On Parsing', () => {
    it('should parse valid default-runs-on with single quotes', async () => {
      setupInput({ 'default-runs-on': "[ 'ubuntu-latest' ]" })

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.setOutput).toHaveBeenCalledWith(
        'runs-on',
        expect.stringContaining('ubuntu-latest')
      )
    })

    it('should parse valid default-runs-on with double quotes', async () => {
      setupInput({ 'default-runs-on': '[ "windows-latest" ]' })

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should fail with invalid JSON format in default-runs-on', async () => {
      setupInput({ 'default-runs-on': 'not-valid-json' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Invalid default-runs-on-format')
      )
    })

    it('should fail with empty array in default-runs-on', async () => {
      setupInput({ 'default-runs-on': '[]' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Must be a non-empty array with 1 element')
      )
    })

    it('should fail with multiple elements in default-runs-on array', async () => {
      setupInput({
        'default-runs-on': "[ 'ubuntu-latest', 'windows-latest' ]"
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Must be a non-empty array with 1 element')
      )
    })

    it('should fail with non-string element in default-runs-on', async () => {
      setupInput({ 'default-runs-on': '[ 123 ]' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Array must contain a string')
      )
    })

    it('should fail with boolean in default-runs-on', async () => {
      setupInput({ 'default-runs-on': '[ true ]' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Array must contain a string')
      )
    })

    it('should fail with null in default-runs-on', async () => {
      setupInput({ 'default-runs-on': '[ null ]' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Array must contain a string')
      )
    })

    it('should fail with object in default-runs-on', async () => {
      setupInput({ 'default-runs-on': '[ { "runner": "ubuntu" } ]' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Array must contain a string')
      )
    })
  })

  describe('File Fetching', () => {
    it('should throw an error when path points to a directory', async () => {
      const mapping_file = 'folder1'
      setupInput({ 'runs-on-mapping-yaml': mapping_file })

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: [
          { name: 'file1.txt', type: 'file' },
          { name: 'file2.txt', type: 'file' }
        ]
      })

      await run()

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('is a directory, not a file')
      )
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining(mapping_file)
      )
    })

    it('should handle network errors when fetching file', async () => {
      mockOctokit.rest.repos.getContent.mockRejectedValue(
        new Error('Network timeout')
      )

      await run()

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch file')
      )
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Network timeout')
      )
    })

    it('should handle 404 errors for non-existent files', async () => {
      mockOctokit.rest.repos.getContent.mockRejectedValue(
        new Error('Not Found')
      )

      await run()

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('Not Found')
      )
      expect(core.setFailed).toHaveBeenCalled()
    })

    it('should handle permission errors', async () => {
      mockOctokit.rest.repos.getContent.mockRejectedValue(
        new Error('Resource not accessible by integration')
      )

      await run()

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('Resource not accessible')
      )
      expect(core.setFailed).toHaveBeenCalled()
    })

    it('should decode base64 content correctly', async () => {
      const testContent = `ubuntu-latest:
  - test-repo`
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(testContent).toString('base64'),
          size: testContent.length
        }
      })

      await run()

      // Verify it didn't fail on decoding
      expect(core.setFailed).not.toHaveBeenCalled()
    })
  })

  describe('YAML Parsing and Validation', () => {
    it('should handle invalid YAML syntax', async () => {
      const invalidYaml = `ubuntu-latest:
  - verademo-java
  invalid line without proper indentation
  - another-repo`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(invalidYaml).toString('base64'),
          size: invalidYaml.length
        }
      })

      await run()

      expect(core.setFailed).toHaveBeenCalled()
    })

    it('should handle YAML with non-array values', async () => {
      const yamlWithStrings = `ubuntu-latest:
  - verademo-java
windows-latest: "not-an-array"
macos-latest:
  - verademo-ios`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(yamlWithStrings).toString('base64'),
          size: yamlWithStrings.length
        }
      })

      await run()

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining(
          'Skipping key "windows-latest": value is not an array'
        )
      )
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should handle YAML with array containing non-strings', async () => {
      // FAILSAFE_SCHEMA converts most things to strings, but we can test
      // the validation by using a YAML structure with nested objects
      // which would fail the string check
      const yamlWithObjects = `ubuntu-latest:
  - verademo-java
  - name: invalid-object
    type: nested`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(yamlWithObjects).toString('base64'),
          size: yamlWithObjects.length
        }
      })

      await run()

      // Should warn about non-string values (the nested object)
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining(
          'Skipping key "ubuntu-latest": array contains non-string values'
        )
      )
      // Should fail because all mappings become invalid
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('No valid runner mappings found')
      )
    })

    it('should handle YAML with array containing mixed strings and objects', async () => {
      // Test with some valid strings and some invalid nested structures
      const mixedYaml = `ubuntu-latest:
  - verademo-java
  - nested:
      key: value
windows-latest:
  - verademo-dotnet`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(mixedYaml).toString('base64'),
          size: mixedYaml.length
        }
      })

      await run()

      // Should warn about ubuntu-latest having non-string values
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining(
          'Skipping key "ubuntu-latest": array contains non-string values'
        )
      )
      // Should still succeed because windows-latest is valid
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should handle YAML with mixed valid and invalid entries', async () => {
      const mixedYaml = `ubuntu-latest:
  - verademo-java
invalid-key: 123
windows-latest:
  - verademo-dotnet`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(mixedYaml).toString('base64'),
          size: mixedYaml.length
        }
      })

      await run()

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Skipping key "invalid-key"')
      )
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should fail with completely empty YAML file', async () => {
      const emptyYaml = ''

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(emptyYaml).toString('base64'),
          size: 0
        }
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Mapping YAML must be an object')
      )
    })

    it('should fail with YAML that is an array instead of object', async () => {
      const yamlArray = `- ubuntu-latest
- windows-latest`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(yamlArray).toString('base64'),
          size: yamlArray.length
        }
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Mapping YAML must be an object')
      )
    })

    it('should fail with YAML that is just a string', async () => {
      const yamlString = 'just a string'

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(yamlString).toString('base64'),
          size: yamlString.length
        }
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Mapping YAML must be an object')
      )
    })

    it('should fail when all mapping entries are invalid', async () => {
      const allInvalidYaml = `ubuntu-latest: "not-an-array"
windows-latest: 123`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(allInvalidYaml).toString('base64'),
          size: allInvalidYaml.length
        }
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('No valid runner mappings found in YAML file')
      )
    })

    it('should handle YAML with empty arrays', async () => {
      const emptyArrayYaml = `ubuntu-latest: []
windows-latest:
  - verademo-dotnet`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(emptyArrayYaml).toString('base64'),
          size: emptyArrayYaml.length
        }
      })

      await run()

      // Empty array is valid (just won't match any repos)
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should handle YAML with null values', async () => {
      const nullYaml = `ubuntu-latest:
  - verademo-java
windows-latest: null`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(nullYaml).toString('base64'),
          size: nullYaml.length
        }
      })

      await run()

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Skipping key "windows-latest"')
      )
    })
  })

  describe('Repository Matching', () => {
    it('should find and select runner for matched repository', async () => {
      setupInput({ repository: TEST_REPOS.JAVA })

      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `Found repository "${TEST_REPOS.JAVA}" in runs-on group: ubuntu-latest`
        )
      )
      expect(core.setOutput).toHaveBeenCalledWith(
        'runs-on',
        "['ubuntu-latest']"
      )
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should find Windows runner for .NET repository', async () => {
      setupInput({ repository: TEST_REPOS.DOTNET })

      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `Found repository "${TEST_REPOS.DOTNET}" in runs-on group: windows-latest`
        )
      )
      expect(core.setOutput).toHaveBeenCalledWith(
        'runs-on',
        "['windows-latest']"
      )
    })

    it('should match second repository in list', async () => {
      setupInput({ repository: TEST_REPOS.JAVA_MITIGATED })

      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `Found repository "${TEST_REPOS.JAVA_MITIGATED}" in runs-on group: ubuntu-latest`
        )
      )
    })

    it('should use default runner for unmatched repository', async () => {
      setupInput({
        repository: TEST_REPOS.NONEXISTENT,
        'default-runs-on': "[ 'ubuntu-latest' ]"
      })

      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `Repository "${TEST_REPOS.NONEXISTENT}" not found in mapping, using default: ubuntu-latest`
        )
      )
      expect(core.setOutput).toHaveBeenCalledWith(
        'runs-on',
        "['ubuntu-latest']"
      )
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should handle repository with special characters', async () => {
      const specialRepo = 'repo-with-dashes_and_underscores.test'
      const yamlWithSpecialRepo = `ubuntu-latest:
  - ${specialRepo}
  - another-repo`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(yamlWithSpecialRepo).toString('base64'),
          size: yamlWithSpecialRepo.length
        }
      })

      setupInput({ repository: specialRepo })

      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(`Found repository "${specialRepo}"`)
      )
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should be case-sensitive for repository names', async () => {
      setupInput({ repository: 'VERADEMO-JAVA' }) // Uppercase

      await run()

      // Should not match because it's case-sensitive
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('not found in mapping, using default')
      )
    })

    it('should match exact repository names only', async () => {
      setupInput({ repository: 'verademo-java-extra' })

      await run()

      // Should not match 'verademo-java'
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('not found in mapping, using default')
      )
    })

    it('should stop at first match when repository appears in multiple groups', async () => {
      const duplicateYaml = `ubuntu-latest:
  - verademo-java
windows-latest:
  - verademo-java`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(duplicateYaml).toString('base64'),
          size: duplicateYaml.length
        }
      })

      setupInput({ repository: TEST_REPOS.JAVA })

      await run()

      // Should use the first match
      expect(core.setOutput).toHaveBeenCalledWith(
        'runs-on',
        "['ubuntu-latest']"
      )
    })
  })

  describe('Output Generation', () => {
    it('should set correct output format for matched repository', async () => {
      setupInput({ repository: TEST_REPOS.JAVA })

      await run()

      expect(core.setOutput).toHaveBeenCalledWith(
        'runs-on',
        "['ubuntu-latest']"
      )
    })

    it('should set correct output format for default runner', async () => {
      setupInput({
        repository: TEST_REPOS.NONEXISTENT,
        'default-runs-on': "[ 'windows-latest' ]"
      })

      await run()

      expect(core.setOutput).toHaveBeenCalledWith(
        'runs-on',
        "['windows-latest']"
      )
    })

    it('should preserve runner name exactly as specified in YAML', async () => {
      const customRunner = 'self-hosted-runner-123'
      const yamlWithCustomRunner = `${customRunner}:
  - verademo-java`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(yamlWithCustomRunner).toString('base64'),
          size: yamlWithCustomRunner.length
        }
      })

      setupInput({ repository: TEST_REPOS.JAVA })

      await run()

      expect(core.setOutput).toHaveBeenCalledWith(
        'runs-on',
        `['${customRunner}']`
      )
    })

    it('should output self-hosted runner format', async () => {
      const selfHostedYaml = `self-hosted:
  - verademo-java`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(selfHostedYaml).toString('base64'),
          size: selfHostedYaml.length
        }
      })

      setupInput({ repository: TEST_REPOS.JAVA })

      await run()

      expect(core.setOutput).toHaveBeenCalledWith('runs-on', "['self-hosted']")
    })
  })

  describe('Rate Limiting', () => {
    it('should check rate limit before fetching file', async () => {
      await run()

      expect(mockOctokit.rest.rateLimit.get).toHaveBeenCalled()
    })

    it('should log rate limit in debug mode', async () => {
      await run()

      expect(core.debug).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit remaining')
      )
    })

    it('should continue operation even if rate limit is available', async () => {
      mockOctokit.rest.rateLimit.get.mockResolvedValue({
        data: {
          rate: {
            limit: 5000,
            remaining: 1000,
            reset: Math.floor(Date.now() / 1000) + 3600,
            used: 4000
          }
        }
      })

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalled()
    })
  })

  describe('Integration Tests', () => {
    it('should complete full workflow successfully', async () => {
      await run()

      // Verify all steps executed
      expect(mockOctokit.rest.rateLimit.get).toHaveBeenCalled()
      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalled()
      expect(core.setOutput).toHaveBeenCalled()
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should handle complex YAML with multiple runners', async () => {
      const complexYaml = `ubuntu-latest:
  - verademo-java
  - verademo-java-mitigated
  - java-project-1
  - java-project-2
windows-latest:
  - verademo-dotnet
  - verademo-netframework
  - dotnet-project-1
macos-latest:
  - ios-app
  - swift-project
self-hosted:
  - enterprise-app-1
  - enterprise-app-2`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(complexYaml).toString('base64'),
          size: complexYaml.length
        }
      })

      setupInput({ repository: 'java-project-2' })

      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Found repository "java-project-2"')
      )
      expect(core.setOutput).toHaveBeenCalledWith(
        'runs-on',
        "['ubuntu-latest']"
      )
    })

    it('should handle workflow with custom ref branch', async () => {
      const customRef = 'feature/custom-runners'
      setupInput({ ref: customRef, repository: TEST_REPOS.JAVA })

      await run()

      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith(
        expect.objectContaining({ ref: customRef })
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(`(ref: ${customRef})`)
      )
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should handle workflow end-to-end with tag ref', async () => {
      setupInput({ ref: 'v1.0.0', repository: TEST_REPOS.DOTNET })

      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(`Found repository "${TEST_REPOS.DOTNET}"`)
      )
      expect(core.setOutput).toHaveBeenCalledWith(
        'runs-on',
        "['windows-latest']"
      )
    })

    it('should handle large YAML files', async () => {
      // Create a large YAML with many repositories
      const runners = ['ubuntu-latest', 'windows-latest', 'macos-latest']
      let largeYaml = ''
      runners.forEach((runner, idx) => {
        largeYaml += `${runner}:\n`
        for (let i = 0; i < 100; i++) {
          largeYaml += `  - repo-${idx}-${i}\n`
        }
      })

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(largeYaml).toString('base64'),
          size: largeYaml.length
        }
      })

      setupInput({ repository: 'repo-1-50' })

      await run()

      expect(core.setOutput).toHaveBeenCalledWith(
        'runs-on',
        "['windows-latest']"
      )
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string repository name', async () => {
      setupInput({ repository: '' })

      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('not found in mapping, using default')
      )
    })

    it('should handle repository name with whitespace', async () => {
      setupInput({ repository: '  verademo-java  ' })

      await run()

      // Should not match due to whitespace
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('not found in mapping, using default')
      )
    })

    it('should handle very long repository names', async () => {
      const longRepo = 'a'.repeat(100)
      setupInput({ repository: longRepo })

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should handle YAML with Unicode characters', async () => {
      const unicodeYaml = `ubuntu-latest:
  - 项目-中文
  - verademo-java`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(unicodeYaml).toString('base64'),
          size: Buffer.from(unicodeYaml).length
        }
      })

      setupInput({ repository: '项目-中文' })

      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Found repository "项目-中文"')
      )
    })

    it('should handle runner names with special characters', async () => {
      const specialRunnerYaml = `ubuntu-22.04-arm64:
  - verademo-java`

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(specialRunnerYaml).toString('base64'),
          size: specialRunnerYaml.length
        }
      })

      setupInput({ repository: TEST_REPOS.JAVA })

      await run()

      expect(core.setOutput).toHaveBeenCalledWith(
        'runs-on',
        "['ubuntu-22.04-arm64']"
      )
    })
  })
})
