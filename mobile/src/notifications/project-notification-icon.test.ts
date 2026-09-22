import { describe, expect, it } from 'vitest'
import {
  clearProjectNotificationIconsForTest,
  projectNotificationIconForLocation,
  rememberProjectNotificationIcons
} from './project-notification-icon'

const FARM = 'https://github.com/nexos.png?size=64'

describe('project notification icons', () => {
  it('remembers an image icon under the project name the shade leads with', () => {
    clearProjectNotificationIconsForTest()
    rememberProjectNotificationIcons([
      { displayName: 'NexOS', repoIcon: { type: 'image', src: FARM } },
      { displayName: 'Thesis', repoIcon: { type: 'emoji', emoji: '📚' } },
      { displayName: 'Notes', repoIcon: { type: 'lucide', name: 'Folder' } }
    ])

    expect(projectNotificationIconForLocation('NexOS / main')).toBe(FARM)
    expect(projectNotificationIconForLocation('nexos / fix/driver-release')).toBe(FARM)
    expect(projectNotificationIconForLocation('Thesis / main')).toBeNull()
    expect(projectNotificationIconForLocation('Notes')).toBeNull()
    expect(projectNotificationIconForLocation(null)).toBeNull()
  })

  it('drops an image the catalog no longer has, and keeps another host\'s project', () => {
    clearProjectNotificationIconsForTest()
    rememberProjectNotificationIcons([
      { displayName: 'NexOS', repoIcon: { type: 'image', src: FARM } }
    ])
    rememberProjectNotificationIcons([
      { displayName: 'Thesis', repoIcon: { type: 'image', src: 'data:image/png;base64,aaaa' } }
    ])
    rememberProjectNotificationIcons([{ displayName: 'NexOS', repoIcon: null }])

    expect(projectNotificationIconForLocation('NexOS / main')).toBeNull()
    expect(projectNotificationIconForLocation('Thesis / main')).toBe(
      'data:image/png;base64,aaaa'
    )
  })

  it('ignores an icon that is not a picture the shade can decode', () => {
    clearProjectNotificationIconsForTest()
    rememberProjectNotificationIcons([
      { displayName: 'Script', repoIcon: { type: 'image', src: 'data:image/svg+xml,<svg/>' } },
      { displayName: 'Huge', repoIcon: { type: 'image', src: `data:image/png;base64,${'a'.repeat(200_001)}` } },
      { displayName: 'Odd', repoIcon: { type: 'image', src: 'javascript:alert(1)' } }
    ])

    expect(projectNotificationIconForLocation('Script')).toBeNull()
    expect(projectNotificationIconForLocation('Huge')).toBeNull()
    expect(projectNotificationIconForLocation('Odd')).toBeNull()
  })
})
