import { describe, expect, it } from 'vitest'
import { sessionOutputsControl } from './session-outputs'

// The Claude app's rule for its session bar's outputs control (1.261013.20, os30.q,
// os30.java:687-711; labels ns30.H and descriptions ns30.G, ns30.java:610-660).

describe('the session bar’s outputs control', () => {
  it('draws nothing for a session with no pull request, artifact or plan', () => {
    expect(sessionOutputsControl({ pullRequests: 0, artifacts: 0, plan: false })).toBeNull()
  })

  it('keeps one kind as that kind’s own control, never "1 output"', () => {
    expect(sessionOutputsControl({ pullRequests: 1, artifacts: 0, plan: false })?.kind).toBe('pull-requests')
    expect(sessionOutputsControl({ pullRequests: 0, artifacts: 3, plan: false })?.kind).toBe('artifacts')
    expect(sessionOutputsControl({ pullRequests: 0, artifacts: 0, plan: true })?.kind).toBe('plan')
  })

  it('folds a pull request and an artifact into "2 outputs", read "Open pull requests and artifacts"', () => {
    expect(sessionOutputsControl({ pullRequests: 1, artifacts: 1, plan: false })).toEqual({
      kind: 'mixed',
      count: 2,
      label: '2 outputs',
      accessibilityLabel: 'Open pull requests and artifacts'
    })
  })

  it('counts the plan as one output and reads "Open outputs" when there is one', () => {
    expect(sessionOutputsControl({ pullRequests: 0, artifacts: 1, plan: true })).toMatchObject({
      kind: 'mixed',
      label: '2 outputs',
      accessibilityLabel: 'Open outputs'
    })
    expect(sessionOutputsControl({ pullRequests: 1, artifacts: 4, plan: true })).toMatchObject({
      kind: 'mixed',
      count: 6,
      label: '6 outputs',
      accessibilityLabel: 'Open outputs'
    })
  })
})
