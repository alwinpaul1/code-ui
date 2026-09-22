/** Picture icons the shade can draw beside a project. Emoji and lucide glyphs
 *  are not bitmaps, so those notifications keep the app icon. */
const MAX_ICON_CHARS = 200_000

const icons = new Map<string, string>()

function iconKey(name: string): string {
  return name.trim().toLowerCase()
}

function imageSrc(icon: unknown): string | null {
  if (!icon || typeof icon !== 'object') {
    return null
  }
  const record = icon as { type?: unknown; src?: unknown }
  if (record.type !== 'image' || typeof record.src !== 'string') {
    return null
  }
  const src = record.src
  if (src.length === 0 || src.length > MAX_ICON_CHARS) {
    return null
  }
  if (src.startsWith('data:image/svg')) {
    return null
  }
  if (
    src.startsWith('https://') ||
    src.startsWith('http://') ||
    src.startsWith('data:image/')
  ) {
    return src
  }
  return null
}

/** Remember the image icons from one host's repo catalog. A project in this
 *  catalog with no picture is forgotten. Projects of another host stay. */
export function rememberProjectNotificationIcons(repos: readonly unknown[]): void {
  for (const repo of repos) {
    if (!repo || typeof repo !== 'object') {
      continue
    }
    const record = repo as { displayName?: unknown; repoIcon?: unknown }
    if (typeof record.displayName !== 'string') {
      continue
    }
    const key = iconKey(record.displayName)
    if (!key) {
      continue
    }
    const src = imageSrc(record.repoIcon)
    if (src) {
      icons.set(key, src)
    } else {
      icons.delete(key)
    }
  }
}

/** The picture for the project named at the start of a notification location
 *  ("NexOS / main", or "Code UI" when the worktree repeats the repo). */
export function projectNotificationIconForLocation(location: string | null): string | null {
  if (!location) {
    return null
  }
  const project = location.split(' / ')[0]?.trim() ?? ''
  if (!project) {
    return null
  }
  return icons.get(iconKey(project)) ?? null
}

export function clearProjectNotificationIconsForTest(): void {
  icons.clear()
}
