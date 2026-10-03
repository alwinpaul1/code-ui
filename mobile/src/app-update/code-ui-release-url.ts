const CODE_UI_RELEASES_PATH = '/alwinpaul1/code-ui/releases'

/**
 * The link to open for a Code UI release, or null when it is not one.
 *
 * Judged as the URL parser reads it, not as the string looks: `..` and `.` segments (also when
 * percent-encoded) collapse before the path is compared, so `/releases/../../../stablyai/orca`
 * is Orca's repo and not this app's. Credentials, a port, a query and a fragment are refused, as
 * is an encoded slash or backslash in the path, which a browser may resolve after we checked.
 * What comes back is the collapsed form, so the link opened is the link that was checked.
 */
export function normalizeCodeUiReleaseUrl(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null
  }
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null
  }
  if (/%(?:2f|5c)/i.test(url.pathname)) {
    return null
  }
  const path = url.pathname
  if (path !== CODE_UI_RELEASES_PATH && !path.startsWith(`${CODE_UI_RELEASES_PATH}/`)) {
    return null
  }
  return `https://github.com${path}`
}
