import { describe, expect, it } from 'vitest'
import {
  COMPUTER_AWAKE_OPTIONS,
  computerAwakeModeLabel,
  computerAwakeUpdateParams,
  readComputerAwakeModeFromSettings
} from './mobile-computer-awake'

describe('mobile-computer-awake', () => {
  it('offers On, Agent and Off in the desktop popover order', () => {
    expect(COMPUTER_AWAKE_OPTIONS.map((option) => [option.mode, option.label])).toEqual([
      ['on', 'On'],
      ['auto', 'Agent'],
      ['off', 'Off']
    ])
  })

  it.each([
    ['on', { computerAwakeMode: 'on', keepComputerAwakeWhileAgentsRun: true }],
    ['auto', { computerAwakeMode: 'auto', keepComputerAwakeWhileAgentsRun: true }],
    ['off', { computerAwakeMode: 'off', keepComputerAwakeWhileAgentsRun: false }]
  ] as const)('writes both host keys for %s', (mode, expected) => {
    expect(computerAwakeUpdateParams(mode)).toEqual(expected)
  })

  it.each([
    [{ computerAwakeMode: 'on', keepComputerAwakeWhileAgentsRun: true }, 'on'],
    [{ computerAwakeMode: 'auto', keepComputerAwakeWhileAgentsRun: true }, 'auto'],
    [{ computerAwakeMode: 'off', keepComputerAwakeWhileAgentsRun: false }, 'off'],
    // Older host: only the legacy boolean exists.
    [{ keepComputerAwakeWhileAgentsRun: true }, 'auto'],
    [{ keepComputerAwakeWhileAgentsRun: false }, 'off'],
    // Host whitelist without either key (Orca 1.4.197 mobile RPC): unknown, not Off.
    [{ defaultTaskSource: 'github' }, null],
    [null, null]
  ] as const)('reads %o as %s', (settings, expected) => {
    expect(readComputerAwakeModeFromSettings(settings)).toBe(expected)
  })

  it('labels modes the way the desktop popover does', () => {
    expect(computerAwakeModeLabel('on')).toBe('On')
    expect(computerAwakeModeLabel('auto')).toBe('Agent')
    expect(computerAwakeModeLabel('off')).toBe('Off')
    expect(computerAwakeModeLabel(null)).toBe('Loading…')
  })
})
