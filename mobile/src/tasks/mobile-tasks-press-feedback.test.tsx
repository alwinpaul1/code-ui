import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

// Why: the tasks barrel pulls the whole react-native screen graph in. The
// style sheets need only these, straight from their leaf modules.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 0.5 },
  useColorScheme: () => 'light'
}))
vi.mock('./mobile-tasks-dependencies', async () => {
  const theme = await import('../theme/mobile-theme')
  return {
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 },
    Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
    radii: theme.radii,
    spacing: theme.spacing,
    typography: theme.typography
  }
})

import type { ReactElement } from 'react'
import { ThemeProvider, type Theme } from '../theme/theme-context'
import { colorsForScheme, type ThemeScheme } from '../theme/tokens'
import { mobileTasksDetailStyles } from './mobile-tasks-detail-styles'
import { mobileTasksListStyles } from './mobile-tasks-list-styles'
import { contrastRatio } from '../test/contrast'
import { TasksButton, TasksRow } from './mobile-tasks-pressables'
import { mobileTasksProjectPickerStyles } from './mobile-tasks-project-picker-styles'

/** The style factories read only `colors`; this is just enough Theme to call them. */
function themeFor(scheme: ThemeScheme): Theme {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the tasks style factories destructure `colors` and nothing else.
  return { colors: colorsForScheme(scheme) } as Theme
}

const TASKS_DIR = import.meta.dirname

function surfaceSources(): { name: string; source: string }[] {
  return readdirSync(TASKS_DIR)
    .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
    .sort()
    .map((name) => ({ name, source: readFileSync(join(TASKS_DIR, name), 'utf8') }))
}

/** Every `<Tag …>` open tag in a source, with its line. Braces are counted
 *  so a `>` inside an arrow-function prop does not end the tag early. */
function openTags(source: string, tag: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = []
  const re = new RegExp(`<${tag}\\b`, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    let depth = 0
    let end = match.index
    for (let i = match.index; i < source.length; i += 1) {
      const char = source[i]
      if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
      } else if (char === '>' && depth === 0) {
        end = i
        break
      }
    }
    hits.push({
      line: source.slice(0, match.index).split('\n').length,
      text: source.slice(match.index, end + 1)
    })
  }
  return hits
}

// Tapping any action row in the item or project drawer gave NO
// acknowledgment until the async result landed (0.6.6 audit): the row's
// style was a static `styles.actionRow`, so nothing on screen changed on
// press-down. ~140 Pressables on this surface, 5 pressed-aware.
describe('the tasks surface acknowledges every press on the way down', () => {
  it('has no raw Pressable whose style ignores the pressed state', () => {
    const offenders = surfaceSources().flatMap(({ name, source }) =>
      openTags(source, 'Pressable')
        .filter((tag) => !/\bpressed\b/.test(tag.text))
        .map((tag) => `${name}:${tag.line}`)
    )
    expect(offenders).toEqual([])
  })

  it('still has its pressables, so the check above cannot pass on an empty surface', () => {
    // `[].every(...)` is true: a sweep that deleted the rows would pass the
    // test above. Count what the surface routes through the shared shapes.
    const routed = surfaceSources().reduce(
      (count, { source }) =>
        count + openTags(source, 'TasksRow').length + openTags(source, 'TasksButton').length,
      0
    )
    expect(routed).toBeGreaterThanOrEqual(120)
  })
})

type StyleFn = (state: { pressed: boolean }) => unknown[]

function styleAt(element: ReactElement, pressed: boolean, scheme: ThemeScheme = 'light') {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{element}</ThemeProvider>)
  })
  const pressable = renderer!.root.findByType('Pressable' as never)
  const style = pressable.props.style as StyleFn
  expect(typeof style).toBe('function')
  return Object.assign({}, ...style({ pressed }).flat().filter(Boolean))
}

describe.each(['light', 'dark'] as const)('the two tasks shapes in %s', (scheme) => {
  const list = mobileTasksListStyles(themeFor(scheme))
  const detail = mobileTasksDetailStyles(themeFor(scheme))
  const picker = mobileTasksProjectPickerStyles(themeFor(scheme))

  it('TasksRow lifts its background while pressed, like the list rows always did', () => {
    const resting = detail.actionGroup
    const row = createElement(TasksRow, { style: resting })
    expect(styleAt(row, true, scheme).backgroundColor).toBe(list.taskRowPressed.backgroundColor)
    expect(styleAt(row, false, scheme).backgroundColor).toBe(resting.backgroundColor)
  })

  /**
   * The selected row in a picker already rests on `bgRaised`, which is the exact
   * colour the lift paints. So the one row a user has chosen — the one they are
   * most likely to press again — acknowledged nothing at all, while every row
   * around it did. Invisible to every other check, because both sides are the
   * same token and neither is wrong on its own.
   */
  it('lifts a row that already rests at the lift colour to something else', () => {
    const resting = {
      ...picker.pickerRow,
      ...picker.pickerRowSelected
    }
    const row = createElement(TasksRow, { style: resting, raised: true })
    expect(styleAt(row, true, scheme).backgroundColor).not.toBe(resting.backgroundColor)
  })

  it('TasksButton dims while pressed and is opaque at rest', () => {
    const button = createElement(TasksButton, { style: { padding: 4 } })
    expect(styleAt(button, true, scheme).opacity).toBeLessThan(1)
    expect(styleAt(button, false, scheme).opacity).toBeUndefined()
  })

  it('the row lift is a visibly different colour from both surfaces a row sits on', () => {
    const lift = list.taskRowPressed.backgroundColor
    // The action group (drawer rows) and the page (list rows). The floor is
    // the smallest step the palette itself uses for a pressed row, not a
    // target: `bg` -> `bgRaised` in light, 1.094:1 (dark's smallest is
    // `bgPanel` -> `bgRaised`, 1.13:1). A lift set to the group's own colour
    // would be 1:1 and fail here in either scheme.
    for (const surface of [detail.actionGroup.backgroundColor, colorsForScheme(scheme).bg]) {
      expect(lift).not.toBe(surface)
      expect(contrastRatio(lift, surface as string)).toBeGreaterThanOrEqual(1.09)
    }
  })
})

