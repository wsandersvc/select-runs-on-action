/**
 * Unit tests for rate-limiter.ts
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

// Mock @actions/core
jest.unstable_mockModule('@actions/core', () => core)

// Import after mocking
const {
  checkRateLimit,
  getTimeUntilReset,
  logRateLimitInfo,
  RATE_LIMIT_CONFIG
} = await import('../src/rate-limiter.js')

describe('rate-limiter', () => {
  let mockOctokit: any

  beforeEach(() => {
    mockOctokit = {
      rest: {
        rateLimit: {
          get: jest.fn()
        }
      }
    }
    jest.clearAllMocks()
  })

  describe('checkRateLimit', () => {
    it('should allow operation when rate limit is healthy', async () => {
      const now = Math.floor(Date.now() / 1000)
      mockOctokit.rest.rateLimit.get.mockResolvedValue({
        data: {
          rate: {
            limit: 5000,
            remaining: 4500,
            reset: now + 3600,
            used: 500
          }
        }
      })

      const result = await checkRateLimit(mockOctokit, 'test operation')

      expect(result.canProceed).toBe(true)
      expect(result.warning).toBeUndefined()
      expect(result.info.remaining).toBe(4500)
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('4500/5000')
      )
    })

    it('should warn when rate limit is low (below percentage threshold)', async () => {
      const now = Math.floor(Date.now() / 1000)
      mockOctokit.rest.rateLimit.get.mockResolvedValue({
        data: {
          rate: {
            limit: 5000,
            remaining: 500, // 10% remaining
            reset: now + 3600,
            used: 4500
          }
        }
      })

      const result = await checkRateLimit(mockOctokit, 'test operation')

      expect(result.canProceed).toBe(true)
      expect(result.warning).toBeDefined()
      expect(result.warning).toContain('rate limit is low')
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('500/5000')
      )
    })

    it('should warn when rate limit is low (below absolute threshold)', async () => {
      const now = Math.floor(Date.now() / 1000)
      mockOctokit.rest.rateLimit.get.mockResolvedValue({
        data: {
          rate: {
            limit: 100,
            remaining: 9, // Below absolute threshold of 10
            reset: now + 3600,
            used: 91
          }
        }
      })

      const result = await checkRateLimit(mockOctokit, 'test operation')

      expect(result.canProceed).toBe(true)
      expect(result.warning).toBeDefined()
      expect(core.warning).toHaveBeenCalled()
    })

    it('should block operation when rate limit is critically low', async () => {
      const now = Math.floor(Date.now() / 1000)
      mockOctokit.rest.rateLimit.get.mockResolvedValue({
        data: {
          rate: {
            limit: 5000,
            remaining: 2, // Below MIN_REQUIRED_FOR_OPERATION
            reset: now + 3600,
            used: 4998
          }
        }
      })

      const result = await checkRateLimit(mockOctokit, 'test operation')

      expect(result.canProceed).toBe(false)
      expect(result.warning).toBeDefined()
      expect(result.warning).toContain('critically low')
      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('critically low')
      )
    })

    it('should handle rate limit check failure gracefully', async () => {
      mockOctokit.rest.rateLimit.get.mockRejectedValue(
        new Error('Network error')
      )

      const result = await checkRateLimit(mockOctokit, 'test operation')

      expect(result.canProceed).toBe(true) // Allow operation despite check failure
      expect(result.warning).toContain('Network error')
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Unable to check rate limit')
      )
    })

    it('should include operation name in debug logs', async () => {
      const now = Math.floor(Date.now() / 1000)
      mockOctokit.rest.rateLimit.get.mockResolvedValue({
        data: {
          rate: {
            limit: 5000,
            remaining: 4500,
            reset: now + 3600,
            used: 500
          }
        }
      })

      await checkRateLimit(mockOctokit, 'fetch config file')

      expect(core.debug).toHaveBeenCalledWith(
        expect.stringContaining('fetch config file')
      )
    })

    it('should calculate and log time until reset', async () => {
      const now = Math.floor(Date.now() / 1000)
      mockOctokit.rest.rateLimit.get.mockResolvedValue({
        data: {
          rate: {
            limit: 5000,
            remaining: 4500,
            reset: now + 1800, // 30 minutes from now
            used: 500
          }
        }
      })

      await checkRateLimit(mockOctokit, 'test operation')

      expect(core.debug).toHaveBeenCalledWith(
        expect.stringContaining('minutes')
      )
    })
  })

  describe('getTimeUntilReset', () => {
    it('should format time correctly for hours and minutes', () => {
      const now = Math.floor(Date.now() / 1000)
      const reset = now + 7500 // 2 hours 5 minutes

      const result = getTimeUntilReset(reset)

      expect(result).toMatch(/2h \d+m/)
    })

    it('should format time correctly for minutes and seconds', () => {
      const now = Math.floor(Date.now() / 1000)
      const reset = now + 150 // 2 minutes 30 seconds

      const result = getTimeUntilReset(reset)

      expect(result).toMatch(/2m \d+s/)
    })

    it('should format time correctly for seconds only', () => {
      const now = Math.floor(Date.now() / 1000)
      const reset = now + 45 // 45 seconds

      const result = getTimeUntilReset(reset)

      expect(result).toMatch(/\d+s/) // Allow for timing variations
      expect(parseInt(result)).toBeGreaterThanOrEqual(40)
      expect(parseInt(result)).toBeLessThanOrEqual(50)
    })

    it('should return "now" for past or current time', () => {
      const now = Math.floor(Date.now() / 1000)
      const reset = now - 100 // Past time

      const result = getTimeUntilReset(reset)

      expect(result).toBe('now')
    })
  })

  describe('logRateLimitInfo', () => {
    const mockInfo = {
      limit: 5000,
      remaining: 4500,
      reset: Math.floor(Date.now() / 1000) + 3600,
      used: 500
    }

    it('should log info level by default', () => {
      logRateLimitInfo(mockInfo)

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('GitHub API Rate Limit Status')
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('500/5000') // Usage: used/limit
      )
    })

    it('should log warning level when specified', () => {
      logRateLimitInfo(mockInfo, 'warning')

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('GitHub API Rate Limit Status')
      )
    })

    it('should log error level when specified', () => {
      logRateLimitInfo(mockInfo, 'error')

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('GitHub API Rate Limit Status')
      )
    })

    it('should include percentage calculation', () => {
      logRateLimitInfo(mockInfo)

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('90.0%') // 4500/5000 = 90%
      )
    })

    it('should include reset time information', () => {
      logRateLimitInfo(mockInfo)

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Resets in')
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Reset time')
      )
    })
  })

  describe('RATE_LIMIT_CONFIG', () => {
    it('should have reasonable threshold values', () => {
      expect(RATE_LIMIT_CONFIG.WARNING_THRESHOLD_PERCENT).toBeGreaterThan(0)
      expect(RATE_LIMIT_CONFIG.WARNING_THRESHOLD_PERCENT).toBeLessThan(100)
      expect(RATE_LIMIT_CONFIG.ERROR_THRESHOLD_ABSOLUTE).toBeGreaterThan(0)
      expect(
        RATE_LIMIT_CONFIG.MIN_REQUIRED_FOR_OPERATION
      ).toBeGreaterThanOrEqual(1)
    })
  })
})
