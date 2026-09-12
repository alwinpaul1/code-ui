import { beforeEach, describe, expect, it } from 'vitest'
import { resetEffortReportGateForTests, shouldApplyReportedEffort } from './native-chat-effort-report-gate'

describe('a reported effort against the user’s pick', () => {
  beforeEach(resetEffortReportGateForTests)

  it('applies the first report, and a report with no pick behind it', () => {
    expect(shouldApplyReportedEffort({ scopeKey: 's', reportedEffort: 'xhigh', pickedSource: null })).toBe(true)
    expect(shouldApplyReportedEffort({ scopeKey: 's', reportedEffort: 'xhigh', pickedSource: 'reported' })).toBe(true)
  })

  it('does not let a repeat of the pre-pick effort revert a newer pick', () => {
    shouldApplyReportedEffort({ scopeKey: 's', reportedEffort: 'xhigh', pickedSource: null })
    expect(shouldApplyReportedEffort({ scopeKey: 's', reportedEffort: 'xhigh', pickedSource: 'dispatched' })).toBe(false)
  })

  it('lets a changed effort win over the pick', () => {
    shouldApplyReportedEffort({ scopeKey: 's', reportedEffort: 'xhigh', pickedSource: null })
    expect(shouldApplyReportedEffort({ scopeKey: 's', reportedEffort: 'high', pickedSource: 'dispatched' })).toBe(true)
  })

  it('never applies an absent effort', () => {
    expect(shouldApplyReportedEffort({ scopeKey: 's', reportedEffort: null, pickedSource: null })).toBe(false)
  })
})
