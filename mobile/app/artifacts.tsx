import { useCallback } from 'react'
import { useRouter } from 'expo-router'
import { ClaudeArtifactGallery } from '../src/session/ClaudeArtifactGallery'

/** The account's Artifacts gallery (ClaudeArtifactGallery.tsx), opened from Home's Artifacts card. */
export default function ArtifactGalleryRoute() {
  const router = useRouter()
  const back = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/')
    }
  }, [router])
  return <ClaudeArtifactGallery onBack={back} />
}
