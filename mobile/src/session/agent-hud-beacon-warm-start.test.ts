import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const { readWarmStartBeacons, rememberWarmStartBeacon, WARM_START_BEACON_CAP } = await import(
  './agent-hud-beacon-warm-start'
)

function beacon(modelId: string): AgentHudBeacon {
  return {
    agent: 'claude',
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
    store.set('codeui:agent-hud-beacons', '{not json')

    await expect(readWarmStartBeacons()).resolves.toEqual({})
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
