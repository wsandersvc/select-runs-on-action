/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * To mock dependencies in ESM, you can create fixtures that export mock
 * so that the actual '@actions/core' module is not imported.
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
    }
  }
}

const mockGetOctokit = jest.fn()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => ({
  getOctokit: mockGetOctokit
}))

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.js')

const TEST_REPOS = {
  JAVA: 'verademo-java',
  DOTNET: 'verademo-dotnet',
  NONEXISTENT: 'invalid-repo'
}

const TEST_RUNNERS = {
  UBUNTU: "[ 'ubuntu-latest' ]",
  WINDOWS: "[ 'windows-latest' ]"
}

const CONFIG_REPOSITORY = 'veracode'

describe('main.ts', () => {
  const defaultInput: Record<string, string> = {
    'github-token': 'test-token',
    owner: 'test-owner',
    // ref: 'main',
    repository: TEST_REPOS.JAVA,
    'config-repository': CONFIG_REPOSITORY,
    'default-runs-on': TEST_RUNNERS.UBUNTU,
    'runs-on-mapping-yaml': 'runs-on-mapping.yaml'
  }

  const setupInput = (override: Record<string, string> = {}) => {
    core.getInput.mockImplementation((name: string) => {
      const inputs = { ...defaultInput, ...override }
      return inputs[name]
    })
  }

  beforeEach(() => {
    // Set the action's inputs as return values from core.getInput().
    setupInput()

    // Set up mocked data
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from('test content').toString('base64'),
        size: 12
      }
    })
    mockGetOctokit.mockReturnValue(mockOctokit)

    //     mockReadFile.mockResolvedValue(`
    // ubuntu-latest:
    //   - verademo-java
    //   - verademo-java-mitigated
    // windows-latest:
    //   - verademo-dotnet
    //   - verademo-netframework
    // `)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('Should successfully fetch a file from a repository with all required parameters', async () => {
    await run()

    expect(mockGetOctokit).toHaveBeenCalledWith('test-token')
    expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
      owner: defaultInput['owner'],
      repo: defaultInput['config-repository'],
      path: defaultInput['runs-on-mapping-yaml']
    })

    expect(core.info).toHaveBeenCalledWith(
      `Fetching file: ${defaultInput['runs-on-mapping-yaml']} from ${defaultInput['owner']}/${defaultInput['config-repository']}`
    )
    expect(core.info).toHaveBeenCalledWith(
      `Successfully fetched file (12 bytes)`
    )
  })

  it('Should successfully fetch a file from a repository with an optional ref parameter', async () => {
    const ref = 'main'
    setupInput({ ref: ref })

    await run()

    expect(mockGetOctokit).toHaveBeenCalledWith('test-token')
    expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
      owner: defaultInput['owner'],
      repo: defaultInput['config-repository'],
      ref: ref,
      path: defaultInput['runs-on-mapping-yaml']
    })

    expect(core.info).toHaveBeenCalledWith(
      `Fetching file: ${defaultInput['runs-on-mapping-yaml']} from ${defaultInput['owner']}/${defaultInput['config-repository']} (ref: ${ref})`
    )
    expect(core.info).toHaveBeenCalledWith(
      `Successfully fetched file (12 bytes)`
    )
  })

  it('Should throw an error when the path points to a directory instead of a file', async () => {
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
      expect.stringContaining(
        `Failed to fetch file: Path ${mapping_file} is not a file`
      )
    )
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        `Failed to fetch mapping file from ${defaultInput['owner']}/${defaultInput['config-repository']}/${mapping_file}`
      )
    )
  })

  // check if config-repository is empty
})

// it('Validates action inputs', async () => {
//   await run()

//   // Verify that all required inputs were retrieved
//   expect(core.getInput).toHaveBeenCalledWith('repository', { required: true })
//   expect(core.getInput).toHaveBeenCalledWith('default-runs-on', {
//     required: true
//   })
//   expect(core.getInput).toHaveBeenCalledWith('runs-on-mapping-yaml', {
//     required: true
//   })

//   // Verify no failures occurred with valid inputs
//   expect(core.setFailed).not.toHaveBeenCalled()
// })

// it('Handles non-existent runs-on-mapping-yaml file', async () => {
//   const file = path.join('__fixtures__', 'non-existent.yaml').toString()
//   setupInputs({ 'runs-on-mapping-yaml': file })

//   await run()

//   expect(core.setFailed).toHaveBeenCalledWith(
//     expect.stringContaining(
//       'Failed to read mapping file: __fixtures__/non-existent.yaml'
//     )
//   )
// })

// it('Handles YAMLException', async () => {
//   const file = path.join('__fixtures__', 'invalid.yaml').toString()
//   setupInputs({ 'runs-on-mapping-yaml': file })

//   await run()

//   expect(core.setFailed).toHaveBeenCalledWith(
//     expect.stringContaining('YAMLException')
//   )
// })

// it('Handles Keys Without Arrays', async () => {
//   const file = path.join('__fixtures__', 'not-an-array.yaml').toString()
//   setupInputs({ 'runs-on-mapping-yaml': file })

//   await run()

//   expect(core.setFailed).not.toHaveBeenCalled()
// })

// it('Handles Matched Repositories', async () => {
//   const file = path.join('__fixtures__', 'valid.yaml').toString()
//   setupInputs({ 'runs-on-mapping-yaml': file, repository: 'verademo-java' })

//   await run()

//   expect(core.setFailed).not.toHaveBeenCalled()
//   expect(core.info).toHaveBeenCalledWith(
//     expect.stringContaining(
//       'Found repository "verademo-java" in runs_on group: ubuntu-latest'
//     )
//   )
//   expect(core.setOutput).toHaveBeenCalledWith(
//     expect.stringContaining('runs_on'),
//     expect.stringContaining('ubuntu-latest')
//   )
// })
