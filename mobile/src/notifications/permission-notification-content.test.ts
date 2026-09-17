import { describe, expect, it } from 'vitest'
import { permissionNotificationContent } from './permission-notification-content'

const ESCAPE = String.fromCharCode(27)

/**
 * What the shade said before this: "Claude needs input · APPLY_JOBS", with a
 * body of leftover terminal output — "Exit code 1 pages=2 pageheight=841.89
 * pdftotext version 4.00 Copyright 1996-2017 Glyph & Cog, LLC Usage..." — which
 * is the PREVIOUS command's stdout, composed by the desktop. So the notification
 * said something was waiting and not what, and the only way to find out was to
 * unlock, open the app and go looking. Next to it in the same shade, Claude's
 * own notification named the tool, showed the command, and offered Approve and
 * Deny (reported from the phone 2026-09-17).
 *
 * The permission itself is the source here, never the desktop's body text.
 */
describe('turning a permission into what the shade shows', () => {
  it('names what is being asked, and what for', () => {
    expect(
      permissionNotificationContent({
        title: 'Allow Bash?',
        detail: 'Recompile and re-render page 2',
        options: [
          { label: 'Allow', send: '1' },
          { label: 'Deny', send: ESCAPE }
        ]
      })
    ).toMatchObject({
      title: 'Allow Bash?',
      body: 'Recompile and re-render page 2'
    })
  })

  it('carries each option as an action that knows what to send', () => {
    const content = permissionNotificationContent({
      title: 'Allow Bash?',
      options: [
        { label: 'Allow', send: '1' },
        { label: 'Deny', send: ESCAPE }
      ]
    })
    expect(content?.actions).toEqual([
      { identifier: 'permission:0', label: 'Allow', send: '1' },
      { identifier: 'permission:1', label: 'Deny', send: ESCAPE }
    ])
  })

  /**
   * The identifier is the INDEX, not the label. Android hands back only the
   * identifier when an action is tapped, and an agent is free to label its
   * options anything — "Yes, and don't ask again" is a real Claude option. A
   * label-derived id would collide or change between prompts; the index cannot.
   */
  it('keeps identifiers distinct when two options read alike', () => {
    const content = permissionNotificationContent({
      title: 'Allow Edit?',
      options: [
        { label: 'Yes', send: '1' },
        { label: 'Yes, and don’t ask again', send: '2' },
        { label: 'No', send: ESCAPE }
      ]
    })
    expect(content?.actions.map((a) => a.identifier)).toEqual([
      'permission:0',
      'permission:1',
      'permission:2'
    ])
  })

  // The command is worth more than the summary when we have it: it is the thing
  // the user is actually approving, and the thing Claude's own banner shows.
  it('prefers the command over the summary', () => {
    expect(
      permissionNotificationContent({
        title: 'Allow Bash?',
        detail: 'Recompile page 2',
        command: 'pdflatex -interaction=nonstopmode cv.tex',
        options: [{ label: 'Allow', send: '1' }]
      })?.body
    ).toBe('pdflatex -interaction=nonstopmode cv.tex')
  })

  it('falls back to the summary when there is no command', () => {
    expect(
      permissionNotificationContent({
        title: 'Allow Bash?',
        detail: 'Recompile page 2',
        options: [{ label: 'Allow', send: '1' }]
      })?.body
    ).toBe('Recompile page 2')
  })

  /**
   * Refusing is the right answer, not a degraded one: a permission with nothing
   * to send cannot be answered from the shade, and a banner offering buttons
   * that do nothing is worse than the plain one it replaced. The caller keeps
   * the desktop's own notification in that case.
   */
  it.each([
    ['no options at all', { title: 'Allow Bash?', options: [] }],
    ['an option with nothing to send', { title: 'Allow Bash?', options: [{ label: 'Allow', send: '' }] }],
    ['no title', { title: '', options: [{ label: 'Allow', send: '1' }] }]
  ])('shows nothing for %s', (_label, permission) => {
    expect(permissionNotificationContent(permission)).toBeNull()
  })

  // Android shows at most three actions on a notification; a fourth is silently
  // dropped, so the ones that survive must be chosen here rather than by the OS.
  it('keeps the first two and the last when an agent offers more than fits', () => {
    const content = permissionNotificationContent({
      title: 'Allow Edit?',
      options: [
        { label: 'Yes', send: '1' },
        { label: 'Yes, always', send: '2' },
        { label: 'Edit first', send: '3' },
        { label: 'No', send: ESCAPE }
      ]
    })
    expect(content?.actions.map((a) => a.label)).toEqual(['Yes', 'Yes, always', 'No'])
    // The last is the refusal, and it keeps its own index so the send still maps.
    expect(content?.actions.at(-1)).toMatchObject({ identifier: 'permission:3', send: ESCAPE })
  })
})
