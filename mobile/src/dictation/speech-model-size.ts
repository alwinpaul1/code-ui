const BYTES_PER_MB = 1_000_000
const BYTES_PER_GB = 1_000_000_000

export function formatSpeechModelSize(bytes: number | null | undefined): string {
  if (!bytes) {
    return ''
  }
  if (bytes >= BYTES_PER_GB) {
    const gb = Math.round((bytes / BYTES_PER_GB) * 10) / 10
    const text = Number.isInteger(gb) ? String(gb) : gb.toFixed(1)
    return `${text} GB`
  }
  return `${Math.round(bytes / BYTES_PER_MB)} MB`
}
