import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatPermission } from './MobileNativeChatPermission'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  // The card sizes its reading area against the window so a long prompt cannot
  // push the choices off a short screen.
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))

vi.mock('lucide-react-native', () => ({
  FileMinus2: 'FileMinus2',
  FilePen: 'FilePen',
  FilePlus2: 'FilePlus2',
  ShieldQuestion: 'ShieldQuestion'
}))
vi.mock('../components/TextInputModal', () => ({ TextInputModal: 'TextInputModal' }))

describe('MobileNativeChatPermission', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('shows the complete remembered scope and sends only the selected agent response', async () => {
    const prefix = '`python3 /tmp/codeui-network-benchmark.py`'
    const persistentLabel = `Yes, and don't ask again for commands that start with ${prefix}`
    const command = 'python3 /tmp/codeui-network-benchmark.py cold wifi-1'
    const onRespond = vi.fn(async () => true)
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatPermission, {
          permission: {
            title: 'Run this command?',
            detail: `Environment: local\nReason: Measure the connection\n$ ${command}`,
            options: [
              { label: 'Allow once', send: 'y' },
              { label: persistentLabel, send: 'p' },
              { label: 'Deny', send: '\x1b' }
            ]
          },
          onRespond
        })
      )
    })
    const texts = renderer.root.findAllByType('Text')
    // The Claude app shows the scope only through the button itself; the full
    // option label stays on the button as its accessibility label.
    expect(texts.some((text) => text.props.children === command && text.props.selectable)).toBe(
      true
    )
    expect(onRespond).not.toHaveBeenCalled()
    const remembered = renderer.root
      .findAllByType('Pressable')
      .find((button) => button.props.accessibilityLabel === persistentLabel)
    await act(async () => remembered?.props.onPress())
    expect(onRespond).toHaveBeenCalledExactlyOnceWith('p')
  })

  it('accepts only one response when two presses land in the same render batch', async () => {
    let resolveResponse: (accepted: boolean) => void = () => {}
    const response = new Promise<boolean>((resolve) => (resolveResponse = resolve))
    const onRespond = vi.fn(() => response)
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatPermission, {
          permission: { title: 'Approve?', options: [{ label: 'Allow', send: '1' }] },
          onRespond
        })
      )
    })
    const button = renderer.root.findByType('Pressable')

    act(() => {
      button.props.onPress()
      button.props.onPress()
    })

    expect(onRespond).toHaveBeenCalledOnce()
    expect(
      renderer.root
        .findAllByType('Text')
        .some((node) => node.props.children === 'Sending response…')
    ).toBe(true)
    expect(renderer.root.findByType('Pressable').props.disabled).toBe(true)
    await act(async () => resolveResponse(true))
    expect(renderer.root.findByType('Pressable').props.disabled).toBe(true)
    expect(
      renderer.root
        .findAllByType('Text')
        .some((node) => node.props.children === 'Response sent · waiting for agent')
    ).toBe(true)
  })

  it.each([0, 1, 2])(
    'shows sending feedback above the selected choice %i only',
    async (selected) => {
      const options = [
        { label: 'Allow once', send: 'y' },
        { label: "Yes, and don't ask again for commands that start with pnpm test", send: 'p' },
        { label: 'Deny', send: '\x1b' }
      ]
      let finish: (accepted: boolean) => void = () => {}
      const onRespond = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve
          })
      )
      await act(async () => {
        renderer = create(
          createElement(MobileNativeChatPermission, {
            permission: { title: 'Approve?', options },
            onRespond
          })
        )
      })
      act(() => renderer!.root.findAllByType('Pressable')[selected].props.onPress())
      const groups = renderer!.root
        .findAllByType('View')
        .filter(
          (view) =>
            view.findAllByType('Pressable').length === 1 &&
            view.findAllByType('Text').some((text) => text.props.children === 'Sending response…')
        )
      expect(groups).toHaveLength(1)
      expect(groups[0].findByType('Pressable').props.accessibilityLabel).toBe(
        options[selected].label
      )
      expect(
        renderer!.root.findAllByType('Pressable').every((button) => button.props.disabled)
      ).toBe(true)
      expect(
        renderer!.root
          .findAllByType('Pressable')
          .map((button) => button.props.accessibilityState.busy)
      ).toEqual(options.map((_, index) => index === selected))
      expect(onRespond).toHaveBeenCalledExactlyOnceWith(options[selected].send)
      await act(async () => finish(false))
      expect(
        renderer!.root
          .findAllByType('Text')
          .some((text) => text.props.children === 'Sending response…')
      ).toBe(false)
    }
  )

  it('restores choices after a rejected response', async () => {
    const onRespond = vi.fn(async () => false)
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatPermission, {
          permission: { title: 'Approve?', options: [{ label: 'Deny', send: '3' }] },
          onRespond
        })
      )
    })
    await act(async () => renderer.root.findByType('Pressable').props.onPress())
    expect(renderer.root.findByType('Pressable').props.disabled).toBe(false)
    expect(
      renderer.root
        .findAllByType('Text')
        .some((node) => node.props.children === 'Response sent · waiting for agent')
    ).toBe(false)
  })

  it('offers the three Claude choices and leaves the auto-mode switch out', async () => {
    const scope = 'pdftoppm -r 110 -f 2 -l 2 -png main.pdf /private/tmp/fig1'
    const auto = 'Yes, and switch to auto mode · auto mode handles these prompts for you'
    const onRespond = vi.fn(async () => true)
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatPermission, {
          permission: {
            title: 'Allow Bash?',
            command: scope,
            options: [
              { label: 'Yes', send: '1' },
              { label: `Yes, and don’t ask again for: ${scope}`, send: '2' },
              { label: auto, send: '3' },
              { label: 'No', send: '4' }
            ]
          },
          onRespond
        })
      )
    })
    const buttons = renderer.root.findAllByType('Pressable')
    // Claude mobile always shows exactly these three (user's instruction, 2026-09-14).
    expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual([
      'Yes',
      `Yes, and don’t ask again for: ${scope}`,
      'No'
    ])
    expect(buttons.some((button) => button.props.accessibilityLabel === auto)).toBe(false)
    const texts = renderer.root.findAllByType('Text')
    expect(texts.some((text) => text.props.children === 'Always allow for this session')).toBe(true)
    expect(texts.some((text) => text.props.children === scope && text.props.selectable)).toBe(true)
    expect(onRespond).not.toHaveBeenCalled()
    // Deny still sends the TUI's own digit for "No", which is 4 here, not 3.
    await act(async () => buttons[2].props.onPress())
    expect(onRespond).toHaveBeenCalledExactlyOnceWith('4')
  })

  it('keeps the choices reachable when the agent offers many long ones', () => {
    // 2026-09-13, from a screen recording: a long "Allow Bash?" had its buttons
    // under the tools row and the composer, with nothing to tap. The card sits
    // in the dock now, so it must also bound itself — the choices are the only
    // thing the user can act on, so they scroll rather than run off the bottom.
    const options = Array.from({ length: 8 }, (_, index) => ({
      label: `Yes, and don't ask again for commands that start with ${'x'.repeat(120)}${index}`,
      send: String(index)
    }))
    let tree: ReactTestRenderer | null = null
    act(() => {
      tree = create(
        createElement(MobileNativeChatPermission, {
          permission: { title: 'Allow Bash?', detail: 'y'.repeat(4000), options },
          onRespond: vi.fn(async () => true)
        })
      )
    })
    const scrollers = tree!.root.findAllByType('ScrollView')
    const bounded = scrollers.filter((node) => {
      const style = node.props.style as { maxHeight?: number } | undefined
      return typeof style?.maxHeight === 'number' && style.maxHeight > 0
    })
    // Reading area, remembered-scope blocks, and the choices themselves.
    expect(bounded.length).toBeGreaterThanOrEqual(2)
    const choices = scrollers.find((node) =>
      node.findAllByType('Text').some((text) => String(text.props.children).includes('Always allow for this session'))
    )
    expect(choices).toBeDefined()
    const choiceStyle = choices!.props.style as { maxHeight?: number; flexShrink?: number }
    expect(choiceStyle.maxHeight).toBeGreaterThan(0)
    expect(choiceStyle.flexShrink).toBe(1)
    act(() => tree!.unmount())
  })

  it("keeps the agent's own explanation next to the command it is asking about", async () => {
    // 2026-09-14: the card rendered `command ?? description`, so whenever a
    // command was present the agent's summary of what it wanted to do was
    // dropped — the user approved a command with its explanation removed.
    const command = 'rm -rf /private/tmp/codeui-scratch'
    const detail = 'Clear the scratch directory before the next run'
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatPermission, {
          permission: {
            title: 'Allow Bash?',
            detail,
            command,
            options: [
              { label: 'Yes', send: '1' },
              { label: 'No', send: '2' }
            ]
          },
          onRespond: vi.fn(async () => true)
        })
      )
    })
    const texts = renderer!.root.findAllByType('Text').map((text) => String(text.props.children))
    expect(texts.some((text) => text.includes(detail))).toBe(true)
    expect(texts.some((text) => text.includes(command))).toBe(true)
  })

  it('wraps prose instead of running it off the side of a horizontal scroll', async () => {
    // 2026-09-14 review: the previous version of this test rendered a
    // permission with NO command, so the horizontal ScrollView never existed
    // and its assertion loop ran zero times — it passed whatever the code did.
    // Give it a command, so the horizontal block is really there, and prove the
    // prose is not inside it.
    const detail = 'This session wants to write outside the workspace. '.repeat(4)
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatPermission, {
          permission: {
            title: 'Approve?',
            detail,
            command: 'rm -rf /private/tmp/scratch',
            options: [{ label: 'Yes', send: '1' }]
          },
          onRespond: vi.fn(async () => true)
        })
      )
    })
    const horizontal = renderer!.root
      .findAllByType('ScrollView')
      .filter((node) => node.props.horizontal === true)
    // The block must exist, or this test proves nothing.
    expect(horizontal.length).toBeGreaterThan(0)
    for (const scroller of horizontal) {
      const inside = scroller.findAllByType('Text').map((text) => String(text.props.children))
      expect(inside.some((text) => text.includes('write outside the workspace'))).toBe(false)
      expect(inside.some((text) => text.includes('rm -rf'))).toBe(true)
    }
    // And the prose is rendered somewhere, wrapping, outside that block.
    const all = renderer!.root.findAllByType('Text').map((text) => String(text.props.children))
    expect(all.some((text) => text.includes('write outside the workspace'))).toBe(true)
  })

  it('keeps the agent\'s choices when auto mode is the only one it offered', async () => {
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatPermission, {
          permission: {
            title: 'Approve?',
            options: [{ label: 'Yes, and switch to auto mode · handles these for you', send: '3' }]
          },
          onRespond: vi.fn(async () => true)
        })
      )
    })
    expect(renderer!.root.findAllByType('Pressable')).toHaveLength(1)
  })

  describe('plan review feedback', () => {
    // Real captured options, Claude Code 2.1.276 (claude-plan-permission.test.ts).
    const planOptions = [
      { label: 'Yes, and use auto mode', send: '1' },
      { label: 'Yes, manually approve edits', send: '2' },
      { label: 'Tell Claude what to change', send: '3' }
    ]

    it('opens a comment sheet instead of sending immediately', async () => {
      const onRespond = vi.fn(async () => true)
      const onRespondWithComment = vi.fn(async () => true)
      await act(async () => {
        renderer = create(
          createElement(MobileNativeChatPermission, {
            permission: { title: 'Ready to code?', options: planOptions },
            onRespond,
            onRespondWithComment
          })
        )
      })
      const buttons = renderer!.root.findAllByType('Pressable')
      expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual([
        'Yes, and use auto mode',
        'Yes, manually approve edits',
        'Tell Claude what to change'
      ])
      const sendBack = renderer!.root
        .findAllByType('Text')
        .find((text) => text.props.children === 'Send back')
      expect(sendBack).toBeDefined()
      await act(async () => buttons[2]!.props.onPress())
      expect(onRespond).not.toHaveBeenCalled()
      expect(onRespondWithComment).not.toHaveBeenCalled()
      expect(renderer!.root.findByType('TextInputModal').props.visible).toBe(true)
    })

    it('submits the typed comment through onRespondWithComment, never onRespond', async () => {
      const onRespond = vi.fn(async () => true)
      const onRespondWithComment = vi.fn(async () => true)
      await act(async () => {
        renderer = create(
          createElement(MobileNativeChatPermission, {
            permission: { title: 'Ready to code?', options: planOptions },
            onRespond,
            onRespondWithComment
          })
        )
      })
      const button = renderer!.root
        .findAllByType('Pressable')
        .find((candidate) => candidate.props.accessibilityLabel === 'Tell Claude what to change')
      await act(async () => button!.props.onPress())
      const sheet = renderer!.root.findByType('TextInputModal')
      await act(async () => sheet.props.onSubmit('Use two sentences instead.'))
      expect(onRespondWithComment).toHaveBeenCalledExactlyOnceWith('3', 'Use two sentences instead.')
      expect(onRespond).not.toHaveBeenCalled()
      expect(renderer!.root.findByType('TextInputModal').props.visible).toBe(false)
    })

    it('sends a plain reject (empty comment) rather than refusing to submit', async () => {
      const onRespondWithComment = vi.fn(async () => true)
      await act(async () => {
        renderer = create(
          createElement(MobileNativeChatPermission, {
            permission: { title: 'Ready to code?', options: planOptions },
            onRespond: vi.fn(async () => true),
            onRespondWithComment
          })
        )
      })
      const button = renderer!.root
        .findAllByType('Pressable')
        .find((candidate) => candidate.props.accessibilityLabel === 'Tell Claude what to change')
      await act(async () => button!.props.onPress())
      const sheet = renderer!.root.findByType('TextInputModal')
      expect(sheet.props.allowEmpty).toBe(true)
      await act(async () => sheet.props.onSubmit(''))
      expect(onRespondWithComment).toHaveBeenCalledExactlyOnceWith('3', '')
    })

    it('cancels without sending anything', async () => {
      const onRespond = vi.fn(async () => true)
      const onRespondWithComment = vi.fn(async () => true)
      await act(async () => {
        renderer = create(
          createElement(MobileNativeChatPermission, {
            permission: { title: 'Ready to code?', options: planOptions },
            onRespond,
            onRespondWithComment
          })
        )
      })
      const button = renderer!.root
        .findAllByType('Pressable')
        .find((candidate) => candidate.props.accessibilityLabel === 'Tell Claude what to change')
      await act(async () => button!.props.onPress())
      const sheet = renderer!.root.findByType('TextInputModal')
      await act(async () => sheet.props.onCancel())
      expect(onRespond).not.toHaveBeenCalled()
      expect(onRespondWithComment).not.toHaveBeenCalled()
      expect(renderer!.root.findByType('TextInputModal').props.visible).toBe(false)
    })

    it('falls back to a direct reject when the caller wires no comment path (structured lane)', async () => {
      const onRespond = vi.fn(async () => true)
      await act(async () => {
        renderer = create(
          createElement(MobileNativeChatPermission, {
            permission: { title: 'Ready to code?', options: planOptions },
            onRespond
          })
        )
      })
      const button = renderer!.root
        .findAllByType('Pressable')
        .find((candidate) => candidate.props.accessibilityLabel === 'Tell Claude what to change')
      // No "Send back" affordance without a way to carry the comment.
      expect(
        renderer!.root.findAllByType('Text').some((text) => text.props.children === 'Send back')
      ).toBe(false)
      await act(async () => button!.props.onPress())
      expect(onRespond).toHaveBeenCalledExactlyOnceWith('3')
      expect(renderer!.root.findByType('TextInputModal').props.visible).toBe(false)
    })
  })
})

/**
 * Feasibility map row #35: the VS Code extension shows the diff BEFORE the user
 * accepts an Edit. On the phone the same approval arrived as one JSON slab —
 * `{"file_path":"…","old_string":"…","new_string":"…"}` — rendered as prose,
 * and the diff only appeared after the edit had been applied.
 *
 * The SDK lane's `detail` is the tool input, stringified by the host: Orca
 * 1.4.205 `out/main/index.js` builds the approval item as
 * `detail: JSON.stringify(input)` through a 16 KiB head bound
 * (`inlineHeadBytes: 16*1024`), and appends
 * `\n[Orca: output truncated — N bytes total, digest …]` when it clipped.
 */
describe('the proposed change on a permission card', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const ORCA_INLINE_HEAD_BYTES = 16 * 1024

  /** The host's own clipping, byte for byte: a UTF-8 head plus its marker. */
  function clippedLikeOrca(json: string): string {
    const bytes = Buffer.from(json, 'utf8')
    const head = bytes.subarray(0, ORCA_INLINE_HEAD_BYTES).toString('utf8')
    return `${head}\n[Orca: output truncated — ${bytes.byteLength} bytes total, digest 0123456789ab]`
  }

  const EDIT_INPUT = {
    file_path: '/w/src/app.ts',
    old_string: 'const a = 1\nconst b = 2\nconst c = 3',
    new_string: 'const a = 1\nconst b = 9\nconst c = 3',
    replace_all: false
  }

  const OPTIONS = [
    { label: 'Yes', send: '1' },
    { label: "Yes, and don't ask again for: /w/src/app.ts", send: '2' },
    { label: 'No', send: '3' }
  ]

  type Rendered = {
    rows: { marker: string; text: string; background: string | undefined }[]
    texts: string[]
    buttons: string[]
  }

  function styleValue(style: unknown, key: string): string | undefined {
    const entries = Array.isArray(style) ? style.flat(3) : [style]
    let found: string | undefined
    for (const entry of entries) {
      const value = (entry as Record<string, unknown> | null | undefined)?.[key]
      if (typeof value === 'string') {
        found = value
      }
    }
    return found
  }

  function read(tree: ReactTestRenderer): Rendered {
    const texts = tree.root
      .findAllByType('Text')
      .map((node) => node.props.children)
      .filter((value): value is string => typeof value === 'string')
    const markers = tree.root.findAll((node) => node.props?.testID === 'diff-card-marker')
    const bodies = tree.root.findAll((node) => node.props?.testID === 'diff-card-text')
    const rows = markers.map((marker, index) => ({
      marker: String(marker.props.children),
      text: String(bodies[index]?.props.children ?? ''),
      background: styleValue(marker.parent?.props.style, 'backgroundColor')
    }))
    const buttons = tree.root
      .findAllByType('Pressable')
      .map((button) => String(button.props.accessibilityLabel))
    return { rows, texts, buttons }
  }

  function render(
    permission: { title: string; detail?: string; options: { label: string; send: string }[] },
    scheme: 'light' | 'dark' = 'light'
  ): Rendered {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileNativeChatPermission, {
            permission,
            onRespond: vi.fn(async () => true)
          })
        )
      )
    })
    return read(renderer!)
  }

  it('shows the proposed change as a diff before the user accepts an Edit', () => {
    const { rows, texts } = render({
      title: 'Allow Edit?',
      detail: JSON.stringify(EDIT_INPUT),
      options: OPTIONS
    })
    expect(rows.map((row) => `${row.marker}${row.text}`)).toEqual([
      ' const a = 1',
      '-const b = 2',
      '+const b = 9',
      ' const c = 3'
    ])
    expect(texts).toContain('app.ts')
    // The edit has not happened: the header must not say it has.
    expect(texts).toContain('Proposed edit')
    expect(texts).not.toContain('Edited file')
    // And the JSON slab is gone from the card.
    expect(texts.some((text) => text.includes('old_string'))).toBe(false)
  })

  it('shows a Write as the whole new content and says it writes the file', () => {
    // Pre-approval there is no way to read what the file holds now, so a Write
    // is shown as what it will contain, never as a fake full diff.
    const { rows, texts } = render({
      title: 'Allow Write?',
      detail: JSON.stringify({ file_path: '/w/notes.md', content: '# Notes\n\nfirst\n' }),
      options: OPTIONS
    })
    expect(rows.map((row) => `${row.marker}${row.text}`)).toEqual(['+# Notes', '+', '+first'])
    expect(texts).toContain('Writes file')
    expect(texts).toContain('notes.md')
  })

  it('leaves a hook-envelope Edit ask as plain text, since its detail is a bare path', () => {
    // The live-prompt lane builds the same "Allow Edit?" title but its detail
    // is the hook summary (a path, not JSON). It must fall through to the old
    // rendering, not a diff of nothing.
    const { rows, texts } = render({
      title: 'Allow Edit?',
      detail: '/w/src/app.ts',
      options: OPTIONS
    })
    expect(rows).toEqual([])
    expect(texts).toContain('/w/src/app.ts')
    expect(texts).not.toContain('Proposed edit')
  })

  it('keeps the options exactly as given beneath the diff', async () => {
    const onRespond = vi.fn(async () => true)
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatPermission, {
          permission: {
            title: 'Allow Edit?',
            detail: JSON.stringify(EDIT_INPUT),
            options: OPTIONS
          },
          onRespond
        })
      )
    })
    const buttons = renderer!.root.findAllByType('Pressable')
    expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual(
      OPTIONS.map((option) => option.label)
    )
    await act(async () => buttons[2].props.onPress())
    expect(onRespond).toHaveBeenCalledExactlyOnceWith('3')
  })

  it('falls back to the text detail, and says why, when the host clipped the payload', () => {
    // A partial diff is worse than none: it would show half an edit as the
    // whole of it. The clipped JSON does not parse, so the card refuses.
    const big = {
      file_path: '/w/src/generated.ts',
      old_string: 'x'.repeat(10_000),
      new_string: 'y'.repeat(10_000)
    }
    const detail = clippedLikeOrca(JSON.stringify(big))
    const { rows, texts } = render({ title: 'Allow Edit?', detail, options: OPTIONS })
    expect(rows).toEqual([])
    const notice = texts.find((text) => /too large to preview/i.test(text))
    expect(notice).toBeDefined()
    // What IS known is said: the file, and how big the request was.
    expect(notice).toContain('generated.ts')
    expect(notice).toMatch(/20\s?KB/)
    // Today's text detail remains beneath it.
    expect(texts.some((text) => text.startsWith('{"file_path"'))).toBe(true)
  })

  it('draws no diff for a Bash ask, whose detail is JSON too', () => {
    const { rows, texts } = render({
      title: 'Allow Bash?',
      detail: JSON.stringify({ command: 'pnpm test', description: 'Run the suite' }),
      options: OPTIONS
    })
    expect(rows).toEqual([])
    expect(texts.some((text) => text.includes('pnpm test'))).toBe(true)
  })

  it('tints the proposed rows for the theme in use, in light and in dark', () => {
    const permission = { title: 'Allow Edit?', detail: JSON.stringify(EDIT_INPUT), options: OPTIONS }
    const light = render(permission)
    const lightAdd = light.rows.find((row) => row.marker === '+')?.background
    act(() => renderer?.unmount())
    renderer = null
    const dark = render(permission, 'dark')
    const darkAdd = dark.rows.find((row) => row.marker === '+')?.background
    expect(lightAdd).toBe(lightColors.diffAddBg)
    expect(darkAdd).toBe(darkColors.diffAddBg)
    expect(lightAdd).not.toBe(darkAdd)
  })

  it('folds a long proposed change and shows all of it on request', async () => {
    const content = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join('\n')
    const { rows, buttons } = render({
      title: 'Allow Write?',
      detail: JSON.stringify({ file_path: '/w/long.txt', content }),
      options: OPTIONS
    })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(80)
    const showAll = renderer!.root
      .findAllByType('Pressable')
      .find((button) => /show all 80 lines/i.test(String(button.props.accessibilityLabel)))
    expect(showAll).toBeDefined()
    // The choices are still exactly the agent's, before and after.
    expect(buttons.filter((label) => OPTIONS.some((option) => option.label === label))).toHaveLength(
      3
    )
    await act(async () => showAll!.props.onPress())
    expect(read(renderer!).rows).toHaveLength(80)
  })
})
