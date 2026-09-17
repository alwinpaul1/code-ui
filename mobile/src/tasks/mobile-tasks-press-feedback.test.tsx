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
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 0.5 }
}))
vi.mock('./mobile-tasks-dependencies', async () => {
  const theme = await import('../theme/mobile-theme')
  return {
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 },
    Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
    colors: theme.colors,
    radii: theme.radii,
    spacing: theme.spacing,
    typography: theme.typography
  }
})

import { colors } from '../theme/mobile-theme'
import { mobileTasksDetailStyles } from './mobile-tasks-detail-styles'
import { mobileTasksListStyles } from './mobile-tasks-list-styles'
import { contrastRatio } from '../test/contrast'
import { TasksButton, TasksRow } from './mobile-tasks-pressables'
import { mobileTasksProjectPickerStyles } from './mobile-tasks-project-picker-styles'

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

function styleAt(element: ReturnType<typeof createElement>, pressed: boolean) {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(element)
  })
  const pressable = renderer!.root.findByType('Pressable' as never)
  const style = pressable.props.style as StyleFn
  expect(typeof style).toBe('function')
  return Object.assign({}, ...style({ pressed }).flat().filter(Boolean))
}

describe('the two tasks shapes', () => {
  it('TasksRow lifts its background while pressed, like the list rows always did', () => {
    const resting = mobileTasksDetailStyles.actionGroup
    const row = createElement(TasksRow, { style: resting })
    expect(styleAt(row, true).backgroundColor).toBe(mobileTasksListStyles.taskRowPressed.backgroundColor)
    expect(styleAt(row, false).backgroundColor).toBe(resting.backgroundColor)
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
      ...mobileTasksProjectPickerStyles.pickerRow,
      ...mobileTasksProjectPickerStyles.pickerRowSelected
    }
    const row = createElement(TasksRow, { style: resting, raised: true })
    expect(styleAt(row, true).backgroundColor).not.toBe(resting.backgroundColor)
  })

  it('TasksButton dims while pressed and is opaque at rest', () => {
    const button = createElement(TasksButton, { style: { padding: 4 } })
    expect(styleAt(button, true).opacity).toBeLessThan(1)
    expect(styleAt(button, false).opacity).toBeUndefined()
  })

  it('the row lift is a visibly different colour from both surfaces a row sits on', () => {
    const lift = mobileTasksListStyles.taskRowPressed.backgroundColor
    // The action group (drawer rows) and the page (list rows). The ratio is
    // the palette's existing bgPanel → bgRaised step, not a target; a lift
    // set to the group's own colour would be invisible and fail here.
    for (const surface of [mobileTasksDetailStyles.actionGroup.backgroundColor, colors.bgBase]) {
      expect(lift).not.toBe(surface)
      expect(contrastRatio(lift, surface as string)).toBeGreaterThanOrEqual(1.1)
    }
  })
})

