const BYTES_PER_MB = 1_000_000
const BYTES_PER_GB = 1_000_000_000

export function formatSpeechModelSize(bytes: number | null | undefined): string {
  if (!bytes) {
    return ''
  }
  // Rounded first: from 999.5 MB up to a gigabyte, rounding after the GB test
  // had been passed over printed "1000 MB" (review of 2026-09-30).
  const mb = Math.round(bytes / BYTES_PER_MB)
  if (mb < 1000) {
    return `${mb} MB`
  }
  const gb = Math.round((bytes / BYTES_PER_GB) * 10) / 10
  const text = Number.isInteger(gb) ? String(gb) : gb.toFixed(1)
  return `${text} GB`
}
