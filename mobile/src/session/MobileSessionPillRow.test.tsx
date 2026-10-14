import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'

// The Claude Android app's session pills (1.261009.20). Each is the generic chip `jc20.c`: a
// 14 dp radius, 12 x 8 dp padding, the icon (16 dp), an 8 dp gap, the label at 13/550, on the
// app's surface with a hairline. The pull request pill (`jc20.q`) shows the number in the app's
// muted text, the icon tinted by state, and CI as a dot beside "CI", or the word Merged for a
// merged PR. Create PR tints its icon blue; Local changes opens a hint of at most 280 dp.

const sheets = vi.hoisted(() => ({
  props: [] as {
    visible: boolean
    actions: { label: string; onPress: () => void }[]
    onClose: () => void
  }[]
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true })
)
vi.mock('../components/ActionSheetModal', () => ({
  ActionSheetModal: (props: (typeof sheets.props)[number]) => {
    sheets.props.push(props)
    return null
  }
}))
// The connected row's own reads and clipboard are not this file's business: it drives the view.
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: async () => {} }) }))
vi.mock('./use-session-pills', () => ({ useSessionPills: () => [] }))

import { ThemeProvider } from '../theme/theme-context'
import { SessionPillRowView } from './MobileSessionPillRow'
import { LOCAL_CHANGES_HINT, type SessionPill } from './session-pill-row-model'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  sheets.props.length = 0
})

type Scheme = 'light' | 'dark'

function pr(over: Partial<Extract<SessionPill, { kind: 'pull-request' }>> = {}): SessionPill {
  return {
    kind: 'pull-request',
    number: 7701,
    label: '#7701',
    state: 'open',
    stateLabel: 'Open',
    tint: 'success',
    ci: 'failed',
    spoken: 'Pull request #7701',
    url: 'https://example.test/pr/7701',
    ...over
  }
}
const CREATE: SessionPill = { kind: 'create-pr', label: 'Create PR' }
const LOCAL: SessionPill = { kind: 'local-changes', label: 'Local changes', hint: LOCAL_CHANGES_HINT }

function mount(scheme: Scheme, pills: SessionPill[], over: { open?: () => void; copy?: (n: number) => void } = {}) {
  const open = over.open ?? vi.fn()
  const copy = over.copy ?? vi.fn()
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <SessionPillRowView pills={pills} onOpenPullRequest={open} onCopyPrNumber={copy} />
      </ThemeProvider>
    )
  })
  return { open, copy }
}

const palette = (scheme: Scheme) => (scheme === 'light' ? lightColors : darkColors)

function flat(style: unknown): Record<string, unknown> {
  const list = [style].flat(Infinity)
  return Object.assign({}, ...list.filter((entry) => entry && typeof entry === 'object'))
}
function chip(id: string): ReactTestInstance {
  // The host element, not the component that wraps it: the style and handlers are the host's.
  return renderer!.root.find((node) => node.props.testID === id && typeof node.type === 'string')
}
function chipStyle(node: ReactTestInstance): Record<string, unknown> {
  const style = node.props.style
  return flat(typeof style === 'function' ? style({ pressed: false }) : style)
}
function texts(node: ReactTestInstance): string[] {
  return node
    .findAll((child) => (child.type as unknown) === 'Text')
    .map((child) => [child.props.children].flat().join(''))
}
function icon(node: ReactTestInstance, name: string): ReactTestInstance {
  return node.find((child) => (child.type as unknown) === name)
}
function textNode(node: ReactTestInstance, text: string): ReactTestInstance {
  return node.find(
    (child) => (child.type as unknown) === 'Text' && [child.props.children].flat().join('') === text
  )
}

describe.each(['light', 'dark'] as const)('the session pills in %s mode', (scheme) => {
  const colors = palette(scheme)

  describe('the chip', () => {
    it("is the app's generic chip: 14 dp radius, 12 x 8 padding, an 8 dp gap, a hairline on its surface", () => {
      mount(scheme, [CREATE])
      expect(chipStyle(chip('create-pr-pill'))).toMatchObject({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        backgroundColor: colors.composerFill,
        borderColor: colors.composerBorderFocused
      })
    })

    it('is a button for a screen reader, and presses to the theme’s pressed step', () => {
      mount(scheme, [CREATE])
      expect(chip('create-pr-pill').props.accessibilityRole).toBe('button')
      const style = chip('create-pr-pill').props.style as (s: { pressed: boolean }) => unknown
      expect(flat(style({ pressed: true })).backgroundColor).toBe(colors.composerControlPressed)
    })

    it('sets its label at 13 dp, the app’s chip text', () => {
      mount(scheme, [CREATE])
      expect(flat(textNode(chip('create-pr-pill'), 'Create PR').props.style).fontSize).toBe(13)
    })
  })

  describe('the pull request pill', () => {
    it.each([
      ['open', 'GitPullRequest', 'success', 'success'],
      ['draft', 'GitPullRequestDraft', 'muted', 'textMuted'],
      ['closed', 'GitPullRequestClosed', 'danger', 'danger'],
      ['merged', 'GitMerge', 'merged', 'mergedPurple']
    ] as const)('draws a %s PR with its own icon in the theme’s colour', (state, iconName, tint, token) => {
      mount(scheme, [pr({ state, tint, ci: null, stateLabel: 'x' })])
      const pill = chip('pull-request-pill')
      expect(icon(pill, iconName).props.color).toBe(colors[token])
      expect(icon(pill, iconName).props.size).toBe(16)
    })

    it('shows the number in muted text, with the CI dot and "CI" for a PR whose checks fail', () => {
      mount(scheme, [pr()])
      const pill = chip('pull-request-pill')
      expect(texts(pill)).toEqual(['#7701', 'CI'])
      expect(flat(textNode(pill, '#7701').props.style).color).toBe(colors.textMuted)
      expect(flat(textNode(pill, 'CI').props.style).color).toBe(colors.textMuted)
      expect(flat(pill.findByProps({ testID: 'ci-dot' }).props.style).backgroundColor).toBe(colors.danger)
    })

    it.each([
      ['passed', 'success', 'CI: all checks passed'],
      ['unavailable', 'textMuted', 'CI: status unavailable'],
      ['failed', 'danger', 'CI: checks failing']
    ] as const)('colours a %s CI dot from the theme and says why to a screen reader', (ci, token, spoken) => {
      mount(scheme, [pr({ ci })])
      const pill = chip('pull-request-pill')
      expect(flat(pill.findByProps({ testID: 'ci-dot' }).props.style).backgroundColor).toBe(colors[token])
      expect(pill.props.accessibilityLabel).toBe(`Pull request #7701, Open, ${spoken}`)
    })

    it('draws a spinner, not a dot, while checks run', () => {
      mount(scheme, [pr({ ci: 'pending' })])
      const pill = chip('pull-request-pill')
      expect(pill.findAll((node) => (node.type as unknown) === 'ActivityIndicator')).toHaveLength(1)
      expect(pill.findAll((node) => node.props.testID === 'ci-dot')).toHaveLength(0)
      expect(pill.props.accessibilityLabel).toBe('Pull request #7701, Open, CI: checks in progress')
    })

    it('draws no CI part for a PR with no checks, and the state word instead for a merged one', () => {
      mount(scheme, [pr({ ci: null })])
      expect(texts(chip('pull-request-pill'))).toEqual(['#7701'])
      expect(chip('pull-request-pill').props.accessibilityLabel).toBe('Pull request #7701, Open')
      act(() => renderer?.unmount())
      mount(scheme, [pr({ state: 'merged', stateLabel: 'Merged', tint: 'merged', ci: null })])
      const merged = chip('pull-request-pill')
      expect(texts(merged)).toEqual(['#7701', 'Merged'])
      expect(flat(textNode(merged, 'Merged').props.style).color).toBe(colors.mergedPurple)
      expect(merged.props.accessibilityLabel).toBe('Pull request #7701, Merged')
    })

    it('fills a merged PR’s chip with the purple, not the plain surface', () => {
      mount(scheme, [pr({ state: 'merged', stateLabel: 'Merged', tint: 'merged', ci: null })])
      const style = chipStyle(chip('pull-request-pill'))
      expect(style.backgroundColor).not.toBe(colors.composerFill)
      expect(style.borderColor).not.toBe(colors.composerBorderFocused)
    })

    it('does not bring the copy menu back for another pull request after its own pill went away', () => {
      // A branch switch or a failed refresh takes the pill (and the menu with it) off the screen
      // without the menu being closed; the next pull request must not inherit the open menu.
      const copy = vi.fn()
      const row = (pills: SessionPill[]) => (
        <ThemeProvider initialPreference={scheme}>
          <SessionPillRowView pills={pills} onOpenPullRequest={vi.fn()} onCopyPrNumber={copy} />
        </ThemeProvider>
      )
      act(() => {
        renderer = create(row([pr({ number: 10, label: '#10' })]))
      })
      act(() => chip('pull-request-pill').props.onLongPress())
      expect(sheets.props.at(-1)?.visible).toBe(true)
      act(() => renderer!.update(row([])))
      act(() => renderer!.update(row([pr({ number: 12, label: '#12' })])))
      expect(sheets.props.at(-1)?.visible).toBe(false)
      act(() => chip('pull-request-pill').props.onLongPress())
      act(() => sheets.props.at(-1)!.actions[0]!.onPress())
      expect(copy).toHaveBeenCalledTimes(1)
      expect(copy).toHaveBeenCalledWith(12)
    })

    it('opens the pull request on a tap', () => {
      const { open } = mount(scheme, [pr()])
      act(() => chip('pull-request-pill').props.onPress())
      expect(open).toHaveBeenCalledTimes(1)
    })

    it('offers Copy PR number on a hold, and copies that PR’s number', () => {
      const { copy } = mount(scheme, [pr()])
      expect(sheets.props.at(-1)?.visible).toBe(false)
      act(() => chip('pull-request-pill').props.onLongPress())
      const sheet = sheets.props.at(-1)!
      expect(sheet.visible).toBe(true)
      expect(sheet.actions.map((action) => action.label)).toEqual(['Copy PR number'])
      act(() => sheet.actions[0]!.onPress())
      expect(copy).toHaveBeenCalledWith(7701)
      act(() => sheets.props.at(-1)!.onClose())
      expect(sheets.props.at(-1)?.visible).toBe(false)
    })
  })

  describe('Create PR', () => {
    it('tints its icon blue from the theme, and says Create PR', () => {
      mount(scheme, [CREATE])
      const pill = chip('create-pr-pill')
      expect(icon(pill, 'GitPullRequest').props.color).toBe(colors.info)
      expect(icon(pill, 'GitPullRequest').props.size).toBe(16)
      expect(texts(pill)).toEqual(['Create PR'])
      expect(flat(textNode(pill, 'Create PR').props.style).color).toBe(colors.text)
    })

    it('opens the pull request panel on a tap', () => {
      const { open } = mount(scheme, [CREATE])
      act(() => chip('create-pr-pill').props.onPress())
      expect(open).toHaveBeenCalledTimes(1)
    })
  })

  describe('Local changes and its hint', () => {
    const hint = () => renderer!.root.findAll((node) => node.props.testID === 'local-changes-hint')

    it('draws the branch icon and the label, with the hint closed', () => {
      mount(scheme, [LOCAL])
      const pill = chip('local-changes-pill')
      expect(icon(pill, 'GitBranch').props.color).toBe(colors.text)
      expect(texts(pill)).toEqual(['Local changes'])
      expect(hint()).toHaveLength(0)
    })

    it('opens the app’s hint on a tap, at most 280 dp wide, in the quiet text', () => {
      mount(scheme, [LOCAL])
      act(() => chip('local-changes-pill').props.onPress())
      const [bubble] = hint()
      expect(bubble).toBeDefined()
      expect(flat(bubble!.props.style)).toMatchObject({ maxWidth: 280, paddingVertical: 10 })
      const words = textNode(bubble!, LOCAL_CHANGES_HINT)
      expect(flat(words.props.style)).toMatchObject({ color: colors.textSecondary, fontSize: 13 })
    })

    it('closes the hint on a second tap, and on a tap on the hint itself', () => {
      mount(scheme, [LOCAL])
      act(() => chip('local-changes-pill').props.onPress())
      act(() => chip('local-changes-pill').props.onPress())
      expect(hint()).toHaveLength(0)
      act(() => chip('local-changes-pill').props.onPress())
      act(() => hint()[0]!.props.onPress())
      expect(hint()).toHaveLength(0)
    })

    it('stays closed when the pill comes back after a pull request took its place', () => {
      const open = vi.fn()
      const copy = vi.fn()
      const row = (pills: SessionPill[]) => (
        <ThemeProvider initialPreference={scheme}>
          <SessionPillRowView pills={pills} onOpenPullRequest={open} onCopyPrNumber={copy} />
        </ThemeProvider>
      )
      act(() => {
        renderer = create(row([LOCAL]))
      })
      act(() => chip('local-changes-pill').props.onPress())
      expect(hint()).toHaveLength(1)
      act(() => renderer!.update(row([pr()])))
      act(() => renderer!.update(row([LOCAL])))
      expect(hint()).toHaveLength(0)
    })

    it('says what the pill does, not only what it is', () => {
      mount(scheme, [LOCAL])
      expect(chip('local-changes-pill').props.accessibilityLabel).toBe('Local changes')
      expect(chip('local-changes-pill').props.accessibilityHint).toBe('Shows why there is no pull request')
    })

    it('does not open the pull request panel: there is none to open', () => {
      const { open } = mount(scheme, [LOCAL])
      act(() => chip('local-changes-pill').props.onPress())
      expect(open).not.toHaveBeenCalled()
    })
  })

  it('draws nothing at all for no pills, and never a Diff pill', () => {
    mount(scheme, [])
    expect(renderer!.toJSON()).toBeNull()
    act(() => renderer?.unmount())
    mount(scheme, [pr(), CREATE, LOCAL])
    expect(renderer!.root.findAll((node) => node.props.testID === 'diff-pill')).toHaveLength(0)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('Diff')
  })
})

describe('both schemes read their own palette', () => {
  it('draws a different chip surface in light and in dark', () => {
    mount('light', [CREATE])
    const light = chipStyle(chip('create-pr-pill')).backgroundColor
    act(() => renderer?.unmount())
    mount('dark', [CREATE])
    const dark = chipStyle(chip('create-pr-pill')).backgroundColor
    expect(light).toBe(lightColors.composerFill)
    expect(dark).toBe(darkColors.composerFill)
    expect(light).not.toBe(dark)
  })
})
