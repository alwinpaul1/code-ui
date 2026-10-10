// Orca #26962 (c8b8997762): a Codex model that lists service tiers (Fast, Ultrafast) gets one Speed
// choice in place of the Fast toggle, a pick is seeded into the next chat, and the standard tier adds
// nothing to the pill. Upstream's shared tests (native-chat-session-option-defaults.test.ts,
// structured-agent-session-options.test.ts) do not run in this app, so their new cases live here.
import { describe, expect, it } from 'vitest'
import { CODEX_SESSION_OPTION_CATALOG } from '../../../src/shared/agent-session-option-catalog-claude-codex'
import { resolveStructuredLaunchSeedOptions } from '../../../src/shared/native-chat-session-option-defaults'
import type {
  PersistedNativeChatSessionOptions,
  SessionOptionDescriptor
} from '../../../src/shared/native-chat-session-options'
import {
  applyStructuredAgentSessionOptions,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionPicks,
  structuredAgentSessionOptionSnapshot
} from '../../../src/shared/structured-agent-session-options'
import { mobileOptionsPillLabel } from './mobile-native-chat-session-option-labels'

function speedSnapshot(serviceTier: string): SessionOptionDescriptor[] {
  const state = applyStructuredAgentSessionOptions(
    createStructuredAgentSessionOptionState('codex'),
    CODEX_SESSION_OPTION_CATALOG,
    {
      models: [
        {
          id: 'gpt-6.1-sol',
          label: 'GPT-6.1 Sol',
          isDefault: true,
          efforts: [],
          supportsFastMode: true,
          serviceTiers: [
            { value: 'priority', label: 'Fast' },
            { value: 'ultrafast', label: 'Ultrafast' }
          ]
        }
      ],
      fastModeSupport: { supported: true },
      current: { model: 'gpt-6.1-sol', serviceTier, confirmed: ['serviceTier'] }
    }
  )
  return structuredAgentSessionOptionSnapshot(state)
}

describe('Codex Ultrafast as a speed choice', () => {
  it('offers one speed choice in place of the Fast toggle where the model lists speeds', () => {
    const snapshot = speedSnapshot('ultrafast')
    expect(snapshot.map(({ id }) => id)).toEqual(['model', 'serviceTier'])
    expect(snapshot).toContainEqual(
      expect.objectContaining({
        id: 'serviceTier',
        kind: {
          type: 'select',
          currentValue: 'ultrafast',
          choices: [
            { value: 'default', label: 'Standard' },
            { value: 'priority', label: 'Fast' },
            { value: 'ultrafast', label: 'Ultrafast' }
          ]
        },
        valueSource: 'reported',
        settable: true
      })
    )
  })

  it('names Ultrafast on the pill and leaves the standard tier off it, as Fast off is', () => {
    const options = (snapshot: SessionOptionDescriptor[]) =>
      snapshot.filter((descriptor) => descriptor.category !== 'model')
    expect(mobileOptionsPillLabel(options(speedSnapshot('ultrafast')))).toContain('Ultrafast')
    expect(mobileOptionsPillLabel(options(speedSnapshot('default')))).toBe('')
  })

  it('seeds a saved service tier into the next chat, and remembers a Speed pick', () => {
    const persisted = {
      codex: { model: 'gpt-5.6-sol', valuesByModel: { 'gpt-5.6-sol': { serviceTier: 'ultrafast' } } }
    } as unknown as PersistedNativeChatSessionOptions
    expect(resolveStructuredLaunchSeedOptions(persisted, 'codex')).toEqual({
      model: 'gpt-5.6-sol',
      serviceTier: 'ultrafast'
    })
    // A Speed pick is remembered for the next chat, as model and effort picks are.
    const state = applyStructuredAgentSessionOptions(
      createStructuredAgentSessionOptionState('codex'),
      CODEX_SESSION_OPTION_CATALOG,
      { models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', isDefault: true, efforts: [] }], current: { model: 'gpt-6.1-sol' } }
    )
    expect(structuredAgentSessionOptionPicks(state, { serviceTier: 'ultrafast' })).toEqual([
      { modelId: 'gpt-6.1-sol', optionId: 'serviceTier', value: 'ultrafast' }
    ])
  })
})
