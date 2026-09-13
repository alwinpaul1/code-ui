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
