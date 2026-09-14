import { describe, expect, it } from 'vitest'
import { splitPermissionDetail } from './mobile-permission-detail'

// The exact body the phone showed on 0.5.77, from the user's screenshot.
const REAL_SUMMARY = [
  'Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
  '   │ cd "/Users/alwinpaul/Desktop/Project/Code UI/mobile" && sed -i \'\' \'s/"version": "0.5.76"/"version": "0.5.77"/;',
  '   │ s/"versionCode": 198/"versionCode": 199/\' app.json && npx tsc --noEmit',
  '   Bump to 0.5.77 and run the complete gate',
  ' │ Compound command contains cd with write operation - manual approval required',
  ' Do you want to proceed?'
].join('\n')

describe('splitting an approval summary', () => {
  it('keeps the command and drops the tip and the proceed line', () => {
    const parts = splitPermissionDetail(REAL_SUMMARY, undefined)
    expect(parts.command).toContain('cd "/Users/alwinpaul/Desktop/Project/Code UI/mobile"')
    expect(parts.command).toContain('Compound command contains cd with write operation')
    expect(parts.command).not.toContain('Tip:')
    expect(parts.command).not.toContain('Do you want to proceed')
  })

  it('keeps the step description as prose beside the command', () => {
    expect(splitPermissionDetail(REAL_SUMMARY, undefined).description).toBe(
      'Bump to 0.5.77 and run the complete gate'
    )
  })

  it('never shows the auto-mode tip, which this app has no choice for any more', () => {
    const parts = splitPermissionDetail(REAL_SUMMARY, undefined)
    expect(`${parts.command}\n${parts.description}`).not.toMatch(/auto mode/i)
  })

  it('prefers an explicit command field over the gutter echo', () => {
    expect(splitPermissionDetail(REAL_SUMMARY, 'pnpm test').command).toBe('pnpm test')
  })

  it('leaves prose alone when there is no command at all', () => {
    expect(splitPermissionDetail('This wants to write outside the workspace.', undefined)).toEqual({
      command: null,
      description: 'This wants to write outside the workspace.'
    })
  })

  it('does not repeat the command as prose', () => {
    expect(splitPermissionDetail('rm -rf build', 'rm -rf build').description).toBeNull()
  })

  it('answers with nothing for an empty summary', () => {
    expect(splitPermissionDetail(undefined, undefined)).toEqual({
      command: null,
      description: null
    })
  })
})

it('drops the boilerplate on the legacy "$ " shape too', () => {
  // 2026-09-14 review: any summary with a `$ ` line took a different branch
  // that filtered nothing, so the auto-mode tip came straight back.
  const legacy = [
    'Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
    'Rebuild the release bundle',
    'Do you want to proceed?'
  ].join('\n')
  const parts = splitPermissionDetail(legacy, undefined)
  expect(parts.description).toBe('Rebuild the release bundle')
  expect(parts.description ?? '').not.toMatch(/auto mode|proceed/i)
})

it('treats an ASCII pipe as part of the command, not as a gutter', () => {
  // A shell pipe at the start of a continuation line is far more likely than a
  // gutter the TUI drew; only the box-drawing bar means gutter.
  const parts = splitPermissionDetail('   │ grep -r foo .\n| head -20', undefined)
  expect(parts.command).toContain('grep -r foo .')
  expect(`${parts.command}\n${parts.description}`).toContain('| head -20')
})
