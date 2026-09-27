import { File as FsFile, Paths } from 'expo-file-system'
import type { HostImageFileStore } from './host-image-files'

/**
 * Host pictures as files in the app's cache directory, on Android and iOS
 * (Metro's `.native` extension). Written the way the PDF cache writes its
 * files (mobile-pdf-cache.ts). The system may clear the directory; a picture
 * whose file has gone is read from the host again (host-image-files.ts).
 */
export const hostImageFileStore: HostImageFileStore | null = {
  write: (name, base64) => {
    const file = new FsFile(Paths.cache, name)
    file.create({ overwrite: true })
    file.write(base64, { encoding: 'base64' })
    return file.uri
  },
  exists: (uri) => {
    try {
      return new FsFile(uri).exists
    } catch {
      return false
    }
  }
}
