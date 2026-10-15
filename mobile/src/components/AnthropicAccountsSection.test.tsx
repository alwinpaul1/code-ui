import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The phone's Anthropic accounts on the Anthropic accounts screen: one row per signed-in account with
 * its own "Sign out", "Add another account" (the same paste-the-code flow), and light and dark
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
  startLogin: vi.fn(async () => 'verifier'),
  exchangeCode: vi.fn(async () => ({ accessToken: 'a', refreshToken: 'r', expiresAt: 0 })),
  getSavedVerifier: vi.fn(async (): Promise<string | null> => 'verifier'),
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
  startLogin: store.startLogin,
  exchangeCode: store.exchangeCode,
  getSavedVerifier: store.getSavedVerifier,
  clearCredential: async () => {
    store.cleared += 1
    store.listFails = null
    store.accounts = []
  }
}))

import { AnthropicAccountsSection, ADD_ACCOUNT_HINT } from './AnthropicAccountsSection'
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
const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve()
    }
  })

beforeEach(() => {
  store.accounts = []
  store.cleared = 0
  store.listFails = null
  store.removeFails = null
  store.removed = []
  store.startLogin.mockClear()
  store.exchangeCode.mockClear()
  store.getSavedVerifier.mockResolvedValue('verifier')
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

  it('lists each account once, and says which one voice uses', async () => {
    store.accounts = [PERSONAL, WORK]
    const root = await draw()
    expect(texts(root).filter((text) => text === 'Personal' || text === 'NexDash')).toEqual(['Personal', 'NexDash'])
    expect(texts(root)).toContain('Signed in. Dictation uses this account.')
    expect(texts(root)).toContain('Signed in.')
    expect(root.findAll((node) => String(node.type) === 'Button' && node.props.label === 'Sign out')).toHaveLength(2)
  })

  it('with one account, offers to add another and says to switch accounts on claude.ai first', async () => {
    store.accounts = [PERSONAL]
    const root = await draw()
    expect(texts(root)).toContain('ANTHROPIC ACCOUNT')
    expect(texts(root)).toContain('Add another account')
    expect(texts(root)).toContain('Switch to the other account on claude.ai first.')
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
    expect(all.filter((text) => text.startsWith('Signed in'))).toEqual(['Signed in. Dictation uses this account.'])
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

  it('runs the same paste-the-code sign-in, then lists the new account beside the first', async () => {
    store.accounts = [PERSONAL]
    const root = await draw()
    await press(root, 'Add another account')
    expect(store.startLogin).toHaveBeenCalledTimes(1)
    expect(codeField(root)).toBeDefined()

    store.exchangeCode.mockImplementationOnce(async () => {
      store.accounts = [PERSONAL, WORK]
      return { accessToken: 'w', refreshToken: 'r', expiresAt: 0 }
    })
    await act(async () => {
      codeField(root)!.props.onChangeText('the-code#state')
    })
    await act(async () => {
      button(root, 'Done')!.props.onPress()
    })
    await settle()

    expect(store.exchangeCode).toHaveBeenCalledWith('the-code#state', 'verifier')
    expect(texts(root)).toContain('NexDash')
    expect(root.findAll((node) => String(node.type) === 'TextInput')).toHaveLength(0)
  })

  it('says so when no sign-in is in progress, instead of calling the server', async () => {
    store.accounts = [PERSONAL]
    store.getSavedVerifier.mockResolvedValue(null)
    const root = await draw()
    await press(root, 'Add another account')
    await act(async () => {
      codeField(root)!.props.onChangeText('code#state')
    })
    await act(async () => {
      button(root, 'Done')!.props.onPress()
    })
    await settle()
    expect(store.exchangeCode).not.toHaveBeenCalled()
    expect(texts(root)).toContain('No login in progress. Tap "Log in" first.')
  })

  it('says what the server refused and keeps the code field, leaving the signed-in account alone', async () => {
    store.accounts = [PERSONAL]
    store.exchangeCode.mockRejectedValueOnce(new Error('Token exchange failed (400): bad code'))
    const root = await draw()
    await press(root, 'Add another account')
    await act(async () => {
      codeField(root)!.props.onChangeText('code#state')
    })
    await act(async () => {
      button(root, 'Done')!.props.onPress()
    })
    await settle()
    expect(texts(root)).toContain('Token exchange failed (400): bad code')
    expect(texts(root)).toContain('Personal')
    expect(codeField(root)).toBeDefined()
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
  it('offers to clear the saved sign-ins, and after that the screen reads signed out', async () => {
    store.listFails = new Error('The saved sign-ins could not be parsed')
    const root = await draw()
    await act(async () => {
      button(root, 'Clear saved sign-ins')!.props.onPress()
    })
    await settle()
    expect(store.cleared).toBe(1)
    expect(texts(root).some((text) => text.startsWith('Could not read the saved sign-ins'))).toBe(false)
    expect(button(root, 'Clear saved sign-ins')).toBeUndefined()
    expect(texts(root)).toContain('Sign in to Anthropic')
  })

  it('does not offer to clear anything when the sign-ins read fine', async () => {
    store.accounts = [PERSONAL]
    const root = await draw()
    expect(button(root, 'Clear saved sign-ins')).toBeUndefined()
  })
})
