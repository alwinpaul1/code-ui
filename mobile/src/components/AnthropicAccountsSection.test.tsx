import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The phone's Anthropic accounts on the Anthropic accounts screen: one row per signed-in account with
 * its own "Sign out", "Add another account" (the in-app sign-in, the one way in), and light and dark
 * both drawn from the live theme. The user runs Claude Code under two accounts on the desktop, so
 * the phone signs in to each (2026-10-14).
 */

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('../ui/Button', async () => {
  const React = await import('react')
  return { Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => React.createElement('Button', { label, onPress, disabled }) }
})

const store = vi.hoisted(() => ({
  accounts: [] as ListedAccount[],
  listFails: null as Error | null,
  removeFails: null as Error | null,
  removed: [] as string[],
  cleared: 0
}))

vi.mock('../dictation/anthropic-auth-store', () => ({
  listAccounts: async () => {
    if (store.listFails) {
      throw store.listFails
    }
    return store.accounts
  },
  removeAccount: async (id: string) => {
    if (store.removeFails) {
      throw store.removeFails
    }
    store.removed.push(id)
    store.accounts = store.accounts.filter((account) => account.id !== id)
  },
  accountLabel: (account: { organizationName: string | null }, index: number) => account.organizationName ?? `Account ${index + 1}`,
  clearCredential: async () => {
    store.cleared += 1
    store.listFails = null
    store.accounts = []
  }
}))

const session = vi.hoisted(() => ({
  available: true,
  connected: new Set<string>(),
  listeners: new Set<() => void>(),
  wired: 0,
  opened: [] as (string | null)[]
}))
vi.mock('../session/claude-ai-session', () => ({
  claudeSessionAvailable: () => session.available,
  hasClaudeSession: async (id: string) => session.connected.has(id),
  subscribeClaudeSessionChanged: (listener: () => void) => {
    session.listeners.add(listener)
    return () => session.listeners.delete(listener)
  },
  wireClaudeSessionSignOut: () => {
    session.wired += 1
  }
}))
vi.mock('../session/open-anthropic-sign-in', () => ({
  openAnthropicSignIn: () => {
    session.opened.push(null)
  }
}))

import {
  AnthropicAccountsSection,
  ADD_ACCOUNT_HINT,
  DICTATION_FALLBACK_ROW,
  SIGN_IN_AGAIN_FOR_ARTIFACTS
} from './AnthropicAccountsSection'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

type ListedAccount = {
  id: string
  organizationName: string | null
  credential: { accessToken: string; refreshToken: string; expiresAt: number }
  refreshRefused: boolean
}
const signedIn = (id: string, organizationName: string | null): ListedAccount => ({
  id,
  organizationName,
  credential: { accessToken: `${id}-access`, refreshToken: `${id}-refresh`, expiresAt: Date.now() + 3_600_000 },
  refreshRefused: false
})
const PERSONAL = signedIn('acct-personal', 'Personal')
const WORK = signedIn('acct-work', 'NexDash')
/** A sign-in migrated from 0.9.146 whose token ran out with no refresh token to extend it. */
const DEAD: ListedAccount = { id: 'pending-dead', organizationName: null, credential: { accessToken: 'dead', refreshToken: '', expiresAt: 0 }, refreshRefused: false }

function stylesOf(style: unknown): Record<string, unknown>[] {
  if (Array.isArray(style)) {
    return style.flatMap(stylesOf)
  }
  if (typeof style === 'function') {
    return [...stylesOf(style({ pressed: false })), ...stylesOf(style({ pressed: true }))]
  }
  return typeof style === 'object' && style !== null ? [style as Record<string, unknown>] : []
}

let renderer: ReactTestRenderer | null = null

async function draw(scheme: 'light' | 'dark' = 'light'): Promise<ReactTestInstance> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <AnthropicAccountsSection />
      </ThemeProvider>
    )
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve()
    }
  })
  return renderer!.root
}

const texts = (root: ReactTestInstance) =>
  root.findAll((node) => String(node.type) === 'Text').map((node) => String(node.props.children))
const textNode = (root: ReactTestInstance, text: string) =>
  root.findAll((node) => String(node.type) === 'Text' && node.props.children === text)[0]
const button = (root: ReactTestInstance, label: string, nth = 0) =>
  root.findAll((node) => String(node.type) === 'Button' && node.props.label === label)[nth]
const buttons = (root: ReactTestInstance) =>
  root.findAll((node) => String(node.type) === 'Button').map((node) => String(node.props.label))
const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve()
    }
  })

beforeEach(() => {
  session.available = true
  // Every account in a fixture is connected unless a test says otherwise.
  session.connected = new Set(['acct-personal', 'acct-work', 'acct-unknown', 'pending-dead'])
  session.opened = []
  store.accounts = []
  store.cleared = 0
  store.listFails = null
  store.removeFails = null
  store.removed = []
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('the accounts list', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws every account and the add row from the %s theme', async (scheme, palette) => {
    store.accounts = [PERSONAL, WORK]
    const root = await draw(scheme)

    for (const text of ['Personal', 'NexDash', 'Add another account']) {
      expect(stylesOf(textNode(root, text)!.props.style).map((s) => s.color)).toContain(palette.text)
    }
    expect(stylesOf(textNode(root, ADD_ACCOUNT_HINT)!.props.style).map((s) => s.color)).toContain(palette.textSecondary)
    expect(stylesOf(textNode(root, 'ANTHROPIC ACCOUNTS')!.props.style).map((s) => s.color)).toContain(palette.textMuted)
  })

  it('does not paint the schemes alike, so the pins above can tell them apart', () => {
    expect(lightColors.text).not.toBe(darkColors.text)
    expect(lightColors.textSecondary).not.toBe(darkColors.textSecondary)
  })

  // Review of 2026-10-17: a chat dictates with its own account, so with two signed in the first
  // one no longer says it is the account dictation uses, only the one it falls back to.
  it("lists each account once, and says dictation takes the chat's own account before the first one", async () => {
    store.accounts = [PERSONAL, WORK]
    const root = await draw()
    expect(texts(root).filter((text) => text === 'Personal' || text === 'NexDash')).toEqual(['Personal', 'NexDash'])
    expect(texts(root).filter((text) => text.startsWith('Signed in'))).toEqual([DICTATION_FALLBACK_ROW, 'Signed in.'])
    expect(DICTATION_FALLBACK_ROW).toBe("Signed in. Dictation uses the chat's own account, else this one.")
    expect(texts(root)).not.toContain('Signed in. Dictation uses this account.')
    expect(root.findAll((node) => String(node.type) === 'Button' && node.props.label === 'Sign out')).toHaveLength(2)
  })

  it('with one account, offers to add another in the app', async () => {
    store.accounts = [PERSONAL]
    const root = await draw()
    expect(texts(root)).toContain('ANTHROPIC ACCOUNT')
    expect(texts(root)).toContain('Add another account')
    expect(texts(root)).toContain(ADD_ACCOUNT_HINT)
  })

  it('with none, offers the first sign-in and nothing to sign out of', async () => {
    const root = await draw()
    expect(texts(root)).toContain('Sign in to Anthropic')
    expect(texts(root)).not.toContain('Add another account')
    expect(root.findAll((node) => String(node.type) === 'Button')).toHaveLength(0)
  })

  it('falls back to a numbered name for an account whose organization is not known', async () => {
    store.accounts = [PERSONAL, signedIn('acct-unknown', null)]
    expect(texts(await draw())).toContain('Account 2')
  })
})

describe('an account whose sign-in died (review of 2026-10-14)', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('an expired account with no refresh token says signed out, not "Signed in", in the %s theme', async (scheme, palette) => {
    store.accounts = [DEAD, WORK]
    const root = await draw(scheme)

    const all = texts(root)
    expect(all).toContain('Signed out. Sign in to this account again.')
    // Voice uses the account that still works, and only that one says so.
    expect(all.filter((text) => text.startsWith('Signed in'))).toEqual([DICTATION_FALLBACK_ROW])
    expect(stylesOf(textNode(root, 'Signed out. Sign in to this account again.')!.props.style).map((s) => s.color)).toContain(palette.textSecondary)
  })

  it('a refused refresh reads as signed out once the token has run out', async () => {
    store.accounts = [{ ...PERSONAL, credential: { ...PERSONAL.credential, expiresAt: 0 }, refreshRefused: true }]
    expect(texts(await draw())).toContain('Signed out. Sign in to this account again.')
  })
})

describe('signing out', () => {
  it('signs out the account whose button was pressed and keeps the other listed', async () => {
    store.accounts = [PERSONAL, WORK]
    const root = await draw()
    await act(async () => {
      button(root, 'Sign out', 1)!.props.onPress()
    })
    await settle()
    expect(store.removed).toEqual(['acct-work'])
    expect(texts(root)).toContain('Personal')
    expect(texts(root)).not.toContain('NexDash')
  })

  it('signing out the last account goes back to the first sign-in row', async () => {
    store.accounts = [PERSONAL]
    const root = await draw()
    await act(async () => {
      button(root, 'Sign out')!.props.onPress()
    })
    await settle()
    expect(texts(root)).toContain('Sign in to Anthropic')
  })

  it('says why when the sign-out could not be stored, and keeps the account listed', async () => {
    store.accounts = [PERSONAL]
    store.removeFails = new Error('keystore locked')
    const root = await draw()
    await act(async () => {
      button(root, 'Sign out')!.props.onPress()
    })
    await settle()
    expect(texts(root)).toContain('Could not sign out: keystore locked')
    expect(texts(root)).toContain('Personal')
  })
})

describe('adding an account', () => {
  const press = async (root: ReactTestInstance, label: string) => {
    const row = root.findAll((node) => String(node.type) === 'Pressable' && node.findAll((child) => child.props.children === label).length > 0)[0]
    await act(async () => {
      row!.props.onPress()
    })
    await settle()
  }
  const codeField = (root: ReactTestInstance) => root.findAll((node) => String(node.type) === 'TextInput')[0]

  it('signs in once, in the app, for the account and its artifacts: Add another account opens the in-app sign-in, not the browser', async () => {
    store.accounts = [PERSONAL]
    const root = await draw()
    await press(root, 'Add another account')
    expect(session.opened).toEqual([null])
    expect(codeField(root)).toBeUndefined()
  })

  it('the first sign-in is in the app too', async () => {
    const root = await draw()
    await press(root, 'Sign in to Anthropic')
    expect(session.opened).toEqual([null])
  })

  it('lists the account the in-app sign-in added, once it is back', async () => {
    store.accounts = [PERSONAL]
    const root = await draw()
    store.accounts = [PERSONAL, WORK]
    await act(async () => {
      for (const listener of session.listeners) {
        listener()
      }
    })
    await settle()
    expect(texts(root)).toContain('NexDash')
  })
})

describe('when the saved sign-ins cannot be read', () => {
  it('shows the sign-in row and says why, not a bare button', async () => {
    store.listFails = new Error('keystore locked')
    const root = await draw()
    expect(texts(root)).toContain('Could not read the saved sign-ins: keystore locked')
    expect(texts(root)).toContain('Sign in to Anthropic')
  })

  // An unreadable store is never written over (review of 2026-10-14), so a sign-in on it is
  // refused too. Without a way to start over, a corrupt store locked the user out for good.
  it('offers a single Sign out that clears them, and after that the screen reads signed out', async () => {
    store.listFails = new Error('The saved sign-ins could not be parsed')
    const root = await draw()
    await act(async () => {
      button(root, 'Sign out')!.props.onPress()
    })
    await settle()
    expect(store.cleared).toBe(1)
    expect(texts(root).some((text) => text.startsWith('Could not read the saved sign-ins'))).toBe(false)
    expect(button(root, 'Sign out')).toBeUndefined()
    expect(texts(root)).toContain('Sign in to Anthropic')
  })

  it('says Sign out, never Clear saved sign-ins', async () => {
    store.listFails = new Error('keystore locked')
    const root = await draw()
    expect(buttons(root)).not.toContain('Clear saved sign-ins')
    expect(buttons(root)).toContain('Sign out')
  })

  it.each(['light', 'dark'] as const)('draws Sign out of all accounts on the %s theme', async (scheme) => {
    store.accounts = [PERSONAL, WORK]
    const root = await draw(scheme)
    expect(buttons(root)).toEqual(['Sign out', 'Sign out', 'Sign out of all accounts'])
  })

  it('has no Sign out of all accounts with one account signed in', async () => {
    store.accounts = [PERSONAL]
    const root = await draw()
    expect(button(root, 'Sign out of all accounts')).toBeUndefined()
  })

  it('signs every account out at once with Sign out of all accounts, and the screen reads signed out', async () => {
    store.accounts = [PERSONAL, WORK]
    const root = await draw()
    await act(async () => {
      button(root, 'Sign out of all accounts')!.props.onPress()
    })
    await settle()
    expect(store.cleared).toBe(1)
    expect(store.removed).toEqual([])
    expect(texts(root)).toContain('Sign in to Anthropic')
  })

  it('signs only the tapped account out with its own Sign out', async () => {
    store.accounts = [PERSONAL, WORK]
    const root = await draw()
    await act(async () => {
      button(root, 'Sign out')!.props.onPress()
    })
    await settle()
    expect(store.removed).toEqual(['acct-personal'])
    expect(store.cleared).toBe(0)
    expect(texts(root)).toContain('NexDash')
  })
})

describe('one way in (user, 2026-10-17: one sign-in only)', () => {
  const signInRows = (root: ReactTestInstance) => root.findAll((node) => String(node.type) === 'Pressable')
  it.each([
    ['no account', [] as ListedAccount[]],
    ['one account', [PERSONAL]],
    ['two accounts', [PERSONAL, WORK]]
  ])('offers exactly one way to sign in with %s: the in-app sign-in, no browser row and no code to paste', async (_name, accounts) => {
    store.accounts = accounts
    const root = await draw()
    const rows = signInRows(root)
    expect(rows).toHaveLength(1)
    expect(texts(root).some((text) => /browser|paste|code/i.test(text))).toBe(false)
    await act(async () => {
      rows[0]!.props.onPress()
    })
    await settle()
    expect(session.opened).toEqual([null])
    expect(root.findAll((node) => String(node.type) === 'TextInput')).toHaveLength(0)
  })
})

describe('an account signed in before one sign-in gave it artifacts too', () => {
  it('says on its own row to sign in again to open its artifacts, with no button of a new kind', async () => {
    store.accounts = [PERSONAL, WORK]
    session.connected = new Set(['acct-personal'])
    const root = await draw()
    expect(texts(root).filter((text) => text === SIGN_IN_AGAIN_FOR_ARTIFACTS)).toHaveLength(1)
    // The row keeps the actions it had: Sign out, and the one sign-in (Add another account).
    expect(buttons(root)).toEqual(['Sign out', 'Sign out', 'Sign out of all accounts'])
    expect(texts(root)).toContain('Add another account')
  })

  it('says nothing of the kind for an account already signed in for artifacts, one signed out, or where the phone keeps no claude.ai sign-ins', async () => {
    store.accounts = [PERSONAL, DEAD]
    session.connected = new Set(['acct-personal'])
    expect(texts(await draw())).not.toContain(SIGN_IN_AGAIN_FOR_ARTIFACTS)
    act(() => renderer?.unmount())
    session.available = false
    session.connected = new Set()
    store.accounts = [PERSONAL]
    expect(texts(await draw())).not.toContain(SIGN_IN_AGAIN_FOR_ARTIFACTS)
  })

  it('drops the line once the sign-in again has kept the claude.ai session', async () => {
    store.accounts = [WORK]
    session.connected = new Set()
    const root = await draw()
    expect(texts(root)).toContain(SIGN_IN_AGAIN_FOR_ARTIFACTS)
    session.connected.add('acct-work')
    await act(async () => {
      for (const listener of session.listeners) {
        listener()
      }
    })
    await settle()
    expect(texts(root)).not.toContain(SIGN_IN_AGAIN_FOR_ARTIFACTS)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the line from the %s theme', async (scheme, palette) => {
    store.accounts = [WORK]
    session.connected = new Set()
    const root = await draw(scheme)
    expect(stylesOf(textNode(root, SIGN_IN_AGAIN_FOR_ARTIFACTS)!.props.style).map((s) => s.color)).toContain(palette.textSecondary)
  })

  it('wires sign-out to forget the claude.ai session (claude-ai-session.test.ts pins what that does)', () => {
    expect(session.wired).toBe(1)
  })
})
