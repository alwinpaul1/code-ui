import { DESKTOP_TEXT_READ_CAP } from '../files/mobile-file-preview-response'

/** Above a minified JSON file the viewer pretty-printed: its line numbers are
 *  not the file's, which is why line selection is off there. */
export const REFORMATTED_JSON_NOTICE = 'Formatted for reading: the file itself is one line.'

/** Above a file the host sent only part of: the explorer's and the file
 *  tab's code views and the Markdown preview say the same thing. It names
 *  what the view shows, never the file's size. The phone is not told that:
 *  for any file over the cap `files.read` replies `byteLength: 524289`, the
 *  length of what the host read (DESKTOP_TEXT_READ_CAP), so "File size:
 *  512 KB" was said of every cut file. */
export function previewTruncatedText(): string {
  return `Preview truncated: showing the first ${DESKTOP_TEXT_READ_CAP} of the file.`
}
