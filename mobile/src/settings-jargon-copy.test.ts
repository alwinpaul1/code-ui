import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

describe('settings jargon under the rows', () => {
  it('does not tell people to add accounts from desktop Settings', () => {
    const accounts = source('../app/h/[hostId]/accounts.tsx')
    expect(accounts).toContain('renderProvider')
    expect(accounts).not.toContain('Add or re-authenticate accounts')
    expect(accounts).not.toContain('desktop Settings')
  })

  it('does not explain the desktop theme under Appearance', () => {
    const appearance = source('../app/appearance-settings.tsx')
    expect(appearance).toContain('Theme')
    expect(appearance).not.toContain('colour theme your desktop sends')
  })

  it('does not explain terminal links under Browser', () => {
    const browser = source('../app/browser-settings.tsx')
    expect(browser).toContain('Open terminal links')
    expect(browser).not.toContain('HTTP(S) links tapped in terminal')
  })
})
