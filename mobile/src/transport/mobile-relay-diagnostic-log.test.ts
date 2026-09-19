import { describe, expect, it, vi } from 'vitest'

// Why: the log reads a dial's close code off RelayOuterError (#21566), which lives in the
// e2ee link, whose session module imports expo-crypto and through it React Native's
// Flow-typed entry. The same two mocks upstream's latch and verdict tests use.
vi.mock('./mobile-e2ee-v2-client-session', () => ({
  MobileE2EEV2ClientSession: { create: () => ({}) }
}))
vi.mock('./mobile-e2ee-v2-physical-channel', () => ({
  MobileE2EEAuthenticationError: class extends Error {},
  MobileE2EEV2PhysicalChannel: class {}
}))

import {
  RelayCredentialRefusalTracker,
  createRelayCredentialRefusalRun,
  noteRelayDialFailure,
  noteRelayDialSucceeded
} from './mobile-relay-diagnostic-log'
import { RelayDirectorHttpError } from './mobile-relay-resume-director'

function refused(): Error {
  return new RelayDirectorHttpError(401, null)
}

describe('a relay credential the director refuses', () => {
  it('spends one more dial before parking a phone that saw a single 401', () => {
    // A credential rotating under an in-flight dial answers 401 once. Parking
    // on that answer is a 45-75s outage for a phone whose next dial would have
    // worked (2026-09-14 review of the fix below).
    const arm = vi.fn()
    const log = vi.fn()
    const run = createRelayCredentialRefusalRun()

    noteRelayDialFailure(log, refused(), arm, run)

    expect(arm).not.toHaveBeenCalled()
    expect(log.mock.calls.map((call) => call[0])).toEqual(['relay dial failed'])
  })

  it('stops re-dialling once two refusals land in a row', () => {
    // The reported failure: forty-odd 401s in eight minutes, because the slow
    // reprobe only ran when there was NO credential at all.
    const arm = vi.fn()
    const log = vi.fn()
    const run = createRelayCredentialRefusalRun()

    noteRelayDialFailure(log, refused(), arm, run)
    noteRelayDialFailure(log, refused(), arm, run)

    expect(arm).toHaveBeenCalledOnce()
    expect(log.mock.calls.map((call) => call[1])).toContainEqual(undefined)
    expect(
      log.mock.calls.some(
        (call) => String(call[0]) === 'relay credential expired or rejected; slow reprobe armed'
      )
    ).toBe(true)
  })

  it('forgets the first refusal when the next dial fails for another reason', () => {
    const arm = vi.fn()
    const run = createRelayCredentialRefusalRun()

    noteRelayDialFailure(vi.fn(), refused(), arm, run)
    noteRelayDialFailure(vi.fn(), new Error('socket closed'), arm, run)
    noteRelayDialFailure(vi.fn(), refused(), arm, run)

    expect(arm).not.toHaveBeenCalled()
  })

  it('forgets the refusals once a dial gets through', () => {
    const arm = vi.fn()
    const run = createRelayCredentialRefusalRun()

    noteRelayDialFailure(vi.fn(), refused(), arm, run)
    noteRelayDialSucceeded(run)
    noteRelayDialFailure(vi.fn(), refused(), arm, run)

    expect(arm).not.toHaveBeenCalled()
  })

  it('still logs a 503 as an ordinary failure and never as a credential problem', () => {
    const arm = vi.fn()
    const log = vi.fn()

    noteRelayDialFailure(log, new RelayDirectorHttpError(503, null), arm, createRelayCredentialRefusalRun())
    noteRelayDialFailure(log, new RelayDirectorHttpError(503, null), arm, createRelayCredentialRefusalRun())

    expect(arm).not.toHaveBeenCalled()
    expect(log.mock.calls.every((call) => String(call[0]) === 'relay dial failed')).toBe(true)
  })
})

describe('RelayCredentialRefusalTracker', () => {
  it('arms the reprobe only on the second refusal in a row', () => {
    const arm = vi.fn()
    const tracker = new RelayCredentialRefusalTracker(arm)

    tracker.noteFailure(vi.fn(), refused())
    expect(arm).not.toHaveBeenCalled()
    tracker.noteFailure(vi.fn(), refused())
    expect(arm).toHaveBeenCalledOnce()
  })

  it('lets a dial that got through clear a lone earlier refusal', () => {
    const arm = vi.fn()
    const tracker = new RelayCredentialRefusalTracker(arm)

    tracker.noteFailure(vi.fn(), refused())
    tracker.noteConnected()
    tracker.noteFailure(vi.fn(), refused())

    expect(arm).not.toHaveBeenCalled()
  })
})
