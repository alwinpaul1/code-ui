import { useEffect, useState } from 'react'
import { Image } from 'react-native'
import { ZoomableImage } from '../components/ZoomableImage'

/** An image file in the preview screen, pinchable. Measures the bitmap once
 *  so the zoom clamp knows the drawn size; until then the picture fills the
 *  box. A bitmap that will not measure reports through `onError`, as the
 *  plain Image did. */
export function MobileFileImageZoom({
  uri,
  width,
  height,
  label,
  onError
}: {
  uri: string
  width: number
  height: number
  label: string
  onError?: () => void
}) {
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setAspectRatio(undefined)
    Image.getSize(
      uri,
      (w, h) => {
        if (!cancelled && w > 0 && h > 0) {
          setAspectRatio(w / h)
        }
      },
      () => {
        if (!cancelled) {
          onError?.()
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [onError, uri])
  return (
    <ZoomableImage
      source={{ kind: 'bitmap', uri }}
      width={width}
      height={height}
      aspectRatio={aspectRatio}
      accessibilityLabel={label}
    />
  )
}
