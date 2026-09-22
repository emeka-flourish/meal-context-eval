'use client'
import ZoomPhoto, { type LightboxPhoto } from '@/components/PhotoLightbox'

/* Photo tile → click to view full screen. Thin wrapper over the shared viewer
   (components/PhotoLightbox.tsx). The tile keeps its own open state;
   `onOpenChange` tells callers that pause keyboard shortcuts while it is open. */
export default function ZoomImage({
  src,
  alt,
  label,
  className,
  gallery,
  galleryIndex,
  onOpenChange,
}: {
  src: string
  alt: string
  label?: string
  className?: string
  gallery?: LightboxPhoto[]
  galleryIndex?: number
  open?: boolean
  onOpenChange?: (o: boolean) => void
}) {
  return <ZoomPhoto src={src} alt={alt} label={label} className={className} gallery={gallery} galleryIndex={galleryIndex} onOpenChange={onOpenChange} />
}
