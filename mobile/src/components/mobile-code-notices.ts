import { formatPreviewByteLength } from '../files/mobile-file-preview-response'

/** Above a minified JSON file the viewer pretty-printed: its line numbers are
 *  not the file's, which is why line selection is off there. */
export const REFORMATTED_JSON_NOTICE = 'Formatted for reading: the file itself is one line.'

/** Above a file the host sent only part of: the explorer's and the file
 *  tab's code views say the same thing. */
export function previewTruncatedText(byteLength: number): string {
  return `Preview truncated. File size: ${formatPreviewByteLength(byteLength)}.`
}
