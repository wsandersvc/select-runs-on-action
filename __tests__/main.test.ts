/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * To mock dependencies in ESM, you can create fixtures that export mock
 * functions and objects. For example, the core module is mocked in this test,
 * so that the actual '@actions/core' module is not imported.
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

import path from 'path'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)

// const mockReadFile = jest.fn<(path: string, encoding: string) => Promise<string>>()
// jest.unstable_mockModule('fs', () => ({
//   default: {
//     promises: {
//       readFile: mockReadFile
//     }
//   }
// }))

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.js')

describe('main.ts', () => {
  const defaultInputs: Record<string, string> = {
    repository: 'verademo-java',
    'default-runs-on': 'ubuntu-latest',
    'runs-on-mapping-yaml': path.join('__fixtures__', 'valid.yaml').toString()
  }

  const setupInputs = (overrides: Record<string, string> = {}) => {
    core.getInput.mockImplementation((name: string) => {
      const inputs = { ...defaultInputs, ...overrides }
      return inputs[name]
    })
  }

  beforeEach(() => {
    // Set the action's inputs as return values from core.getInput().
    setupInputs()

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

  it('Validates action inputs', async () => {
    await run()

    // Verify that all required inputs were retrieved
    expect(core.getInput).toHaveBeenCalledWith('repository', { required: true })
    expect(core.getInput).toHaveBeenCalledWith('default-runs-on', {
      required: true
    })
    expect(core.getInput).toHaveBeenCalledWith('runs-on-mapping-yaml', {
      required: true
    })

    // Verify no failures occurred with valid inputs
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('Handles non-existent runs-on-mapping-yaml file', async () => {
    const file = path.join('__fixtures__', 'non-existent.yaml').toString()
    setupInputs({ 'runs-on-mapping-yaml': file })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read mapping file: __fixtures__/non-existent.yaml")
    )
  })

  it('Handles YAMLException', async () => {
    const file = path.join('__fixtures__', 'invalid.yaml').toString()
    setupInputs({ 'runs-on-mapping-yaml': file })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("YAMLException")
    )
  })

  it('Handles Keys Without Arrays', async () => {
    const file = path.join('__fixtures__', 'not-an-array.yaml').toString()
    setupInputs({ 'runs-on-mapping-yaml': file })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('Handles Matched Repositories', async () => {
    const file = path.join('__fixtures__', 'valid.yaml').toString()
    setupInputs({ 'runs-on-mapping-yaml': file, repository: 'verademo-java' })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Found repository "verademo-java" in runs_on group: ubuntu-latest')
    )
    expect(core.setOutput).toHaveBeenCalledWith(
      expect.stringContaining('runs_on'),
      expect.stringContaining('ubuntu-latest')
    )
  })
})
