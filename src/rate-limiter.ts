import * as core from '@actions/core'
import { Octokit } from './main.js'

interface RateLimitInfo {
  limit: number
  remaining: number
  reset: number
  used: number
}

interface RateLimitCheckResult {
  canProceed: boolean
  warning?: string
  info: RateLimitInfo
}

/**
 * Configuration for rate limit thresholds
 */
export const RATE_LIMIT_CONFIG = {
  // Warn when remaining requests drop below this percentage
  WARNING_THRESHOLD_PERCENT: 20,
  // Error when remaining requests drop below this number
  ERROR_THRESHOLD_ABSOLUTE: 10,
  // Minimum remaining requests for this specific operation
  MIN_REQUIRED_FOR_OPERATION: 5
} as const

/**
 * Checks GitHub API rate limit and determines if operation should proceed
 *
 * @param octokit - Authenticated Octokit instance
 * @param operationName - Name of operation for logging
 * @returns Rate limit check result with recommendation
 */
export async function checkRateLimit(
  octokit: Octokit,
  operationName: string = 'API operation'
): Promise<RateLimitCheckResult> {
  try {
    const rateLimit = await octokit.rest.rateLimit.get()
    const { limit, remaining, reset, used } = rateLimit.data.rate

    const resetDate = new Date(reset * 1000)
    const now = new Date()
    const minutesUntilReset = Math.ceil(
      (resetDate.getTime() - now.getTime()) / 60000
    )

    const percentRemaining = (remaining / limit) * 100

    // Log current rate limit status
    core.debug(`Rate limit status for ${operationName}:`)
    core.debug(`  Limit: ${limit}`)
    core.debug(`  Remaining: ${remaining} (${percentRemaining.toFixed(1)}%)`)
    core.debug(`  Used: ${used}`)
    core.debug(
      `  Resets in: ${minutesUntilReset} minutes (${resetDate.toISOString()})`
    )

    const info: RateLimitInfo = { limit, remaining, reset, used }

    // Check if rate limit is exhausted (critical)
    if (remaining < RATE_LIMIT_CONFIG.MIN_REQUIRED_FOR_OPERATION) {
      const errorMsg =
        `GitHub API rate limit critically low (${remaining}/${limit} remaining). ` +
        `Rate limit will reset in ${minutesUntilReset} minutes at ${resetDate.toISOString()}.`

      core.error(errorMsg)

      return {
        canProceed: false,
        warning: errorMsg,
        info
      }
    }

    // Check if rate limit is getting low (warning)
    if (
      remaining < RATE_LIMIT_CONFIG.ERROR_THRESHOLD_ABSOLUTE ||
      percentRemaining < RATE_LIMIT_CONFIG.WARNING_THRESHOLD_PERCENT
    ) {
      const warningMsg =
        `GitHub API rate limit is low (${remaining}/${limit} remaining, ${percentRemaining.toFixed(1)}%). ` +
        `Rate limit will reset in ${minutesUntilReset} minutes.`

      core.warning(warningMsg)

      return {
        canProceed: true,
        warning: warningMsg,
        info
      }
    }

    // All good
    core.info(
      `GitHub API rate limit: ${remaining}/${limit} requests remaining (${percentRemaining.toFixed(1)}%)`
    )

    return {
      canProceed: true,
      info
    }
  } catch (error) {
    // If we can't check rate limit, log warning but allow operation to proceed
    // (the actual API call will fail if rate limited)
    const err = error as Error
    core.warning(
      `Unable to check rate limit: ${err.message}. Proceeding with operation.`
    )

    return {
      canProceed: true,
      warning: `Rate limit check failed: ${err.message}`,
      info: { limit: 0, remaining: 0, reset: 0, used: 0 }
    }
  }
}