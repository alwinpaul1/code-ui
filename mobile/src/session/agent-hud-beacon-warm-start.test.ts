import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key)
    })
  }
}))

import type { AgentHudBeacon } from './agent-hud-beacon'

const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage')

const { readWarmStartBeacons, rememberWarmStartBeacon, WARM_START_BEACON_CAP } = await import(
  './agent-hud-beacon-warm-start'
)

function beacon(modelId: string): AgentHudBeacon {
  return {
    agent: 'claude',
    sessionId: '77954fea-1013-4225-b187-a8b3162a04ce',
    modelId,
    modelLabel: modelId,
    effort: 'xhigh',
    usedTokens: 1234,
    windowTokens: 1_000_000,
    usedPercent: null,
    limits: [],
    doneTaskIds: [],
    runningTaskIdsAt: null,
    receivedAt: 1
  }
}

// 2026-09-18: a stored beacon carried nothing that tied it to the process
// that emitted it, so a hand-started `claude -c` in a terminal that had once
// run a phone-launched agent inherited that agent's model across every app
// restart. Every record written before the session id existed is one of
// those, on every phone, and is discarded on the first launch of this build.
describe('records from before the beacon named its session', () => {
  beforeEach(() => store.clear())

  it('are not read back from the key the old build wrote', async () => {
    store.set(
      'codeui:agent-hud-beacons',
      JSON.stringify({ 'terminal-1': { ...beacon('fable'), sessionId: undefined } })
    )
    await expect(readWarmStartBeacons()).resolves.toEqual({})
  })

  it('are dropped even if one reaches the new key without a session id', async () => {
    const { sessionId: _dropped, ...unsigned } = beacon('fable')
    void _dropped
    await rememberWarmStartBeacon('terminal-1', unsigned as AgentHudBeacon)
    await rememberWarmStartBeacon('terminal-2', beacon('opus'))
    const restored = await readWarmStartBeacons()
    expect(restored['terminal-1']).toBeUndefined()
    expect(restored['terminal-2']?.modelId).toBe('opus')
  })
})

describe('what the HUD shows before the agent has repainted', () => {
  beforeEach(() => store.clear())

  it('still names the model the agent last reported after the app is reopened', async () => {
    // Reported 2026-09-10 with a screenshot: the session was Opus at extra-high
    // effort, changed mid-session, and after closing and reopening the app the
    // picker read "Fable Medium" again. The beacon is a stream event, so a cold
    // start has nothing until the agent next repaints its status line, and the
    // HUD fell back to a staler source.
    await rememberWarmStartBeacon('terminal-1', beacon('opus'))

    const restored = await readWarmStartBeacons()

    expect(restored['terminal-1']?.modelId).toBe('opus')
    expect(restored['terminal-1']?.effort).toBe('xhigh')
  })

  it('keeps the newest reading for a handle rather than the first', async () => {
    await rememberWarmStartBeacon('terminal-1', beacon('fable'))
    await rememberWarmStartBeacon('terminal-1', beacon('opus'))

    expect((await readWarmStartBeacons())['terminal-1']?.modelId).toBe('opus')
  })

  it('remembers each tab separately', async () => {
    await rememberWarmStartBeacon('terminal-1', beacon('opus'))
    await rememberWarmStartBeacon('terminal-2', beacon('sonnet'))

    const restored = await readWarmStartBeacons()
    expect(restored['terminal-1']?.modelId).toBe('opus')
    expect(restored['terminal-2']?.modelId).toBe('sonnet')
  })

  it('sheds the oldest tabs instead of growing without bound', async () => {
    for (let i = 0; i < WARM_START_BEACON_CAP + 3; i += 1) {
      await rememberWarmStartBeacon(`terminal-${i}`, beacon(`m${i}`))
    }

    const restored = await readWarmStartBeacons()
    expect(Object.keys(restored)).toHaveLength(WARM_START_BEACON_CAP)
    expect(restored['terminal-0']).toBeUndefined()
    expect(restored[`terminal-${WARM_START_BEACON_CAP + 2}`]).toBeDefined()
  })

  it('reports nothing rather than throwing when the stored value is unreadable', async () => {
    store.set('codeui:agent-hud-beacons.v2', '{not json')

    await expect(readWarmStartBeacons()).resolves.toEqual({})
  })
})

// Review of 2026-09-30: each write read the store, changed it and wrote it
// back, unserialised. Two tabs' beacons in the same tick both read the store
// before either wrote, and the second write dropped the first tab's record:
// after a restart that tab showed no model pill or context ring until its
// next beacon, and it healed only after the 30 s rewrite throttle.
describe('two tabs writing their warm start at once', () => {
  beforeEach(() => store.clear())

  it('keeps both records when two tabs write in the same tick', async () => {
    await Promise.all([rememberWarmStartBeacon('term_a', beacon('opus')), rememberWarmStartBeacon('term_b', beacon('sonnet'))])
    const restored = await readWarmStartBeacons()
    expect(Object.keys(restored)).toEqual(['term_a', 'term_b'])
    expect(restored['term_a']?.modelId).toBe('opus')
  })

  it('keeps the cap and the newest records when more tabs than it write at once', async () => {
    const count = WARM_START_BEACON_CAP + 3
    await Promise.all(Array.from({ length: count }, (_, i) => rememberWarmStartBeacon(`terminal-${i}`, beacon(`m${i}`))))
    const handles = Object.keys(await readWarmStartBeacons())
    expect(handles).toHaveLength(WARM_START_BEACON_CAP)
    expect(handles[0]).toBe('terminal-3')
    expect(handles.at(-1)).toBe(`terminal-${count - 1}`)
  })

  it('still lands a later write after one the store refused', async () => {
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('database or disk is full'))
    await Promise.all([rememberWarmStartBeacon('term_a', beacon('opus')), rememberWarmStartBeacon('term_b', beacon('sonnet'))])
    await rememberWarmStartBeacon('term_c', beacon('fable'))
    expect(Object.keys(await readWarmStartBeacons())).toEqual(['term_b', 'term_c'])
  })

  it('writes one tab alone as before', async () => {
    await rememberWarmStartBeacon('term_a', beacon('opus'))
    expect(Object.keys(await readWarmStartBeacons())).toEqual(['term_a'])
  })
})

// Review of 2026-09-30: a read the store refused came back as an empty store,
// and the write built on it replaced every other terminal's record with one.
// After the next restart those tabs had no model pill or context ring, and
// nothing in the log said why.
describe('a tab writing its warm start while the store cannot be read', () => {
  const unreadable = new Error('storage unavailable')
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    store.clear()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  it('keeps every other terminal, and lands its own record when the read fails once', async () => {
    await rememberWarmStartBeacon('term_a', beacon('opus'))
    await rememberWarmStartBeacon('term_b', beacon('sonnet'))
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable)
    await rememberWarmStartBeacon('term_c', beacon('fable'))
    expect(Object.keys(await readWarmStartBeacons())).toEqual(['term_a', 'term_b', 'term_c'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('writes nothing, and says why in one line, when the store stays unreadable', async () => {
    await rememberWarmStartBeacon('term_a', beacon('opus'))
    await rememberWarmStartBeacon('term_b', beacon('sonnet'))
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable).mockRejectedValueOnce(unreadable)
    await rememberWarmStartBeacon('term_c', beacon('fable'))
    expect(Object.keys(await readWarmStartBeacons())).toEqual(['term_a', 'term_b'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]).toEqual([expect.stringMatching(/^\[storage\] could not save the warm-start beacons: .*could not be read/), unreadable])
  })

  it('writes the one record when the only record there was could not be read', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable)
    await rememberWarmStartBeacon('term_a', beacon('opus'))
    expect(Object.keys(await readWarmStartBeacons())).toEqual(['term_a'])
  })

  it('still heals a corrupt store by writing fresh, since there is nothing in it to keep', async () => {
    store.set('codeui:agent-hud-beacons.v2', '{not json')
    await rememberWarmStartBeacon('term_a', beacon('opus'))
    expect(Object.keys(await readWarmStartBeacons())).toEqual(['term_a'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('still lands the next tab once the store can be read again', async () => {
    await rememberWarmStartBeacon('term_a', beacon('opus'))
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable).mockRejectedValueOnce(unreadable)
    await rememberWarmStartBeacon('term_b', beacon('sonnet'))
    await rememberWarmStartBeacon('term_c', beacon('fable'))
    expect(Object.keys(await readWarmStartBeacons())).toEqual(['term_a', 'term_c'])
  })

  it('names a refused write in one line too', async () => {
    const full = new Error('database or disk is full')
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(full)
    await rememberWarmStartBeacon('term_a', beacon('opus'))
    expect(warn.mock.calls).toEqual([['[storage] could not save the warm-start beacons', full]])
  })

  it('says why a cold start restored nothing when the store could not be read', async () => {
    await rememberWarmStartBeacon('term_a', beacon('opus'))
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(unreadable)
    await expect(readWarmStartBeacons()).resolves.toEqual({})
    expect(warn.mock.calls).toEqual([['[storage] could not read the warm-start beacons', unreadable]])
  })
})

describe('restoring the HUD on a cold start', () => {
  beforeEach(() => store.clear())

  it('shows the model the agent last reported until it repaints', async () => {
    const { getAgentHudBeacon, hydrateAgentHudBeacons, resetAgentHudBeacons } = await import(
      './agent-hud-beacon'
    )
    resetAgentHudBeacons()
    await rememberWarmStartBeacon('terminal-1', beacon('opus'))
    expect(getAgentHudBeacon('terminal-1')).toBeNull()

    await hydrateAgentHudBeacons()

    expect(getAgentHudBeacon('terminal-1')?.modelId).toBe('opus')
    resetAgentHudBeacons()
  })

  it('counts as never having arrived this run, so a dead process cannot pass for a painting one', async () => {
    const beaconStore = await import('./agent-hud-beacon')
    beaconStore.resetAgentHudBeacons()
    await rememberWarmStartBeacon('terminal-1', beacon('opus'))
    await beaconStore.hydrateAgentHudBeacons()
    expect(beaconStore.getAgentHudBeacon('terminal-1')?.modelId).toBe('opus')
    expect(beaconStore.getAgentHudBeaconArrivedAt('terminal-1')).toBeNull()
    beaconStore.resetAgentHudBeacons()
  })

  it('never overwrites a reading already held for that tab', async () => {
    const beaconStore = await import('./agent-hud-beacon')
    beaconStore.resetAgentHudBeacons()
    await rememberWarmStartBeacon('terminal-1', beacon('opus'))
    await beaconStore.hydrateAgentHudBeacons()
    expect(beaconStore.getAgentHudBeacon('terminal-1')?.modelId).toBe('opus')

    // A later launch's stored value must not displace what this process holds.
    await rememberWarmStartBeacon('terminal-1', beacon('fable'))
    await beaconStore.hydrateAgentHudBeacons()

    expect(beaconStore.getAgentHudBeacon('terminal-1')?.modelId).toBe('opus')
    beaconStore.resetAgentHudBeacons()
  })
})

// Review of 2026-09-27: a stored prompt with no text made the restore throw,
// and every terminal after that one lost its warm start.
describe('a malformed record in the store', () => {
  beforeEach(() => store.clear())

  it('costs only its own bad prompt: the prompts that are whole, and the other records, come back', async () => {
    const good = { ...beacon('opus'), desktopPrompts: [{ nonce: '1', text: 'typed' }] }
    const bad = { ...beacon('fable'), desktopPrompts: [{ nonce: '2' }, { nonce: '3', text: 'kept' }], agentMessagePrompts: [{ text: 'no nonce' }] }
    store.set('codeui:agent-hud-beacons.v2', JSON.stringify({ 'terminal-bad': bad, 'terminal-good': good }))
    const restored = await readWarmStartBeacons()
    // With its arrival, the record's last beacon (receivedAt 1): an older
    // build stored none.
    expect(restored['terminal-good']?.desktopPrompts).toEqual([{ nonce: '1', text: 'typed', seenAt: 1 }])
    expect(restored['terminal-bad']?.desktopPrompts).toEqual([{ nonce: '3', text: 'kept', seenAt: 1 }])
    expect(restored['terminal-bad']?.agentMessagePrompts).toEqual([])
  })

  it('does not stop the other terminals from coming back on a cold start', async () => {
    const beaconStore = await import('./agent-hud-beacon')
    beaconStore.resetAgentHudBeacons()
    const good = { ...beacon('opus'), desktopPrompts: [{ nonce: '1', text: 'typed' }] }
    const bad = { ...beacon('fable'), desktopPrompts: [{ nonce: '2' }] }
    store.set('codeui:agent-hud-beacons.v2', JSON.stringify({ 'terminal-bad': bad, 'terminal-good': good }))
    await expect(beaconStore.hydrateAgentHudBeacons()).resolves.toBeUndefined()
    // Restored with its arrival, the record's last beacon (receivedAt 1).
    expect(beaconStore.getAgentHudBeacon('terminal-good')?.desktopPrompts).toEqual([{ nonce: '1', text: 'typed', seenAt: 1 }])
    expect(beaconStore.getAgentHudBeacon('terminal-bad')?.modelId).toBe('fable')
    beaconStore.resetAgentHudBeacons()
  })

  // Review of 9f9aa4a0..a6857609, nit 6: a subagent list that is not a list
  // was kept, and the restore called `.map` on it.
  it('drops a subagent list that is not a list, and still restores every terminal', async () => {
    const beaconStore = await import('./agent-hud-beacon')
    beaconStore.resetAgentHudBeacons()
    const good = { ...beacon('opus'), desktopPrompts: [{ nonce: '1', text: 'typed' }] }
    const bad = { ...beacon('fable'), desktopPrompts: [], agentMessagePrompts: {} }
    store.set('codeui:agent-hud-beacons.v2', JSON.stringify({ 'terminal-bad': bad, 'terminal-good': good }))
    expect((await readWarmStartBeacons())['terminal-bad']).not.toHaveProperty('agentMessagePrompts')
    await expect(beaconStore.hydrateAgentHudBeacons()).resolves.toBeUndefined()
    // Restored with its arrival, the record's last beacon (receivedAt 1).
    expect(beaconStore.getAgentHudBeacon('terminal-good')?.desktopPrompts).toEqual([{ nonce: '1', text: 'typed', seenAt: 1 }])
    expect(beaconStore.getAgentHudBeacon('terminal-bad')?.modelId).toBe('fable')
    beaconStore.resetAgentHudBeacons()
  })

  it('reads a record with no prompt list as one with none', async () => {
    store.set('codeui:agent-hud-beacons.v2', JSON.stringify({ 'terminal-1': beacon('opus') }))
    expect((await readWarmStartBeacons())['terminal-1']?.desktopPrompts).toEqual([])
  })
})

// Review of 2026-09-30: a long desk prompt cut through a multibyte character
// was read with U+FFFD at its end, and never retired against its transcript
// row. The reader drops it now, but copies an older build stored keep it, and
// a relaunch after the upgrade drew each of them twice again.
describe('a cut desk prompt an older build stored', () => {
  beforeEach(() => store.clear())

  it('comes back without the half character the cut left, so it can retire', async () => {
    const stored = {
      ...beacon('opus'),
      desktopPrompts: [
        { nonce: '1', text: 'Schöne Grü\uFFFD', cut: true },
        // Not cut: a U+FFFD the person typed is theirs.
        { nonce: '2', text: 'typed \uFFFD' },
        // Nothing left once the half character goes: no words to draw or retire.
        { nonce: '3', text: '\uFFFD', cut: true }
      ]
    }
    store.set('codeui:agent-hud-beacons.v2', JSON.stringify({ 'terminal-1': stored }))
    const texts = (await readWarmStartBeacons())['terminal-1']?.desktopPrompts.map((prompt) => prompt.text)
    expect(texts).toEqual(['Schöne Grü', 'typed \uFFFD'])
  })
})
