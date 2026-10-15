import { SESSION_A } from './ccr-session-api-2026-10-14'

// ─── `rate_limit_event` payloads, in the shapes observed live ───────────────
//
// OBSERVED LIVE 2026-10-15 12:47 by the coordinator, both signed-in accounts, shapes only
// (scratchpad/probe/p8-result.json: every key and its type, no values). Five shapes, by count:
//   99  allowed, five_hour, with isUsingOverage / overageDisabledReason / overageStatus
//    2  the same with a third window, unifiedWindows.seven_day_overage_included
//   28  allowed_warning, seven_day, with overageEnabled, surpassedThreshold and utilization
//    1  the same without surpassedThreshold
//    2  rejected, five_hour
// No `parent_tool_use_id` key on any of them. The values below are made up in those shapes:
// `resetsAt` is epoch seconds, as the Claude app reads it (a430.java:884-887); the capture says
// only "number". `utilization` in 0..1 is an assumption the code does not depend on.

export const RESETS_AT_FIVE_HOUR = 1_792_031_400
export const RESETS_AT_SEVEN_DAY = 1_792_447_200

const unifiedWindows = {
  five_hour: { resetsAt: RESETS_AT_FIVE_HOUR, utilization: 0.41 },
  seven_day: { resetsAt: RESETS_AT_SEVEN_DAY, utilization: 0.78 }
}

export function allowedFiveHour(uuid: string): Record<string, unknown> {
  return {
    rate_limit_info: {
      isUsingOverage: false,
      overageDisabledReason: 'org_level_disabled',
      overageStatus: 'rejected',
      rateLimitType: 'five_hour',
      resetsAt: RESETS_AT_FIVE_HOUR,
      status: 'allowed',
      unifiedWindows
    },
    session_id: SESSION_A,
    type: 'rate_limit_event',
    uuid
  }
}

export function warningSevenDay(uuid: string): Record<string, unknown> {
  return {
    rate_limit_info: {
      isUsingOverage: false,
      overageDisabledReason: 'org_level_disabled',
      overageEnabled: false,
      overageStatus: 'rejected',
      rateLimitType: 'seven_day',
      resetsAt: RESETS_AT_SEVEN_DAY,
      status: 'allowed_warning',
      surpassedThreshold: 0.75,
      unifiedWindows,
      utilization: 0.78
    },
    session_id: SESSION_A,
    type: 'rate_limit_event',
    uuid
  }
}

export function rejectedFiveHour(uuid: string): Record<string, unknown> {
  return {
    rate_limit_info: {
      isUsingOverage: false,
      overageDisabledReason: 'org_level_disabled',
      overageStatus: 'rejected',
      rateLimitType: 'five_hour',
      resetsAt: RESETS_AT_FIVE_HOUR,
      status: 'rejected',
      unifiedWindows: { five_hour: { resetsAt: RESETS_AT_FIVE_HOUR, utilization: 1 }, seven_day: unifiedWindows.seven_day }
    },
    session_id: SESSION_A,
    type: 'rate_limit_event',
    uuid
  }
}
