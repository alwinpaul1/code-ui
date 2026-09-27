import type { HostImageFileStore } from './host-image-files'

/**
 * Where host pictures are written: nowhere, here. This file is what the web
 * shell and the test runner load, neither of which has a file system for
 * them, so a picture stays the `data:` URI it came as (host-image-files.ts).
 * On Android and iOS, Metro picks `host-image-file-store.native.ts` instead.
 */
export const hostImageFileStore: HostImageFileStore | null = null
