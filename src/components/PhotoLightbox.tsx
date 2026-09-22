'use client'
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from 'cn'

/* Full-screen photo viewer used by every photo in the console.
   Close: Escape, the ✕, or a click outside the photo. When the photo belongs
   to a set (the photos of one scene), ← / → move between them. */

export type LightboxPhoto = { src: string; alt: string; label?: string }

export function PhotoLightbox({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: LightboxPhoto[]
  /** which photo is open; null = closed */
  index: number | null
  onIndexChange: (i: number) => void
  onClose: () => void
}) {
  const open = index !== null && index >= 0 && index < photos.length
  const n = photos.length

  useEffect(() => {
    if (!open || n < 2) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') onIndexChange(((index as number) + 1) % n)
      else if (e.key === 'ArrowLeft') onIndexChange(((index as number) - 1 + n) % n)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, index, n, onIndexChange])

  const photo = open ? photos[index as number] : null
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        onClick={(e) => {
          // a click on the dark area around the photo closes the viewer
          if (e.target === e.currentTarget) onClose()
        }}
        className="flex h-dvh w-screen max-w-none translate-x-[-50%] translate-y-[-50%] items-center justify-center gap-0 rounded-none border-0 bg-black/95 p-4 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{photo?.alt ?? 'Photo'}</DialogTitle>
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.src} alt={photo.alt} className="max-h-full max-w-full object-contain" />
        )}
        {photo && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-xs text-white">
            {photo.label ?? photo.alt}
            {n > 1 && ` · ${(index as number) + 1} of ${n} · use the arrow keys to move`}
          </div>
        )}
        {n > 1 && open && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => onIndexChange(((index as number) - 1 + n) % n)}
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white hover:bg-white/30"
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => onIndexChange(((index as number) + 1) % n)}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white hover:bg-white/30"
            >
              <ChevronRight className="size-6" />
            </button>
          </>
        )}
        <DialogClose aria-label="Close" className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/30">
          <X className="size-5" />
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}

/** A photo thumbnail that opens full screen when clicked. `gallery` = the other
    photos of the same scene (arrow keys move between them); defaults to just this one. */
export default function ZoomPhoto({
  src,
  alt,
  label,
  className,
  imgClassName,
  gallery,
  galleryIndex = 0,
  stopPropagation = false,
  onOpenChange,
}: {
  src: string
  alt: string
  label?: string
  className?: string
  imgClassName?: string
  gallery?: LightboxPhoto[]
  galleryIndex?: number
  /** set when the thumbnail sits inside another clickable element (a card) */
  stopPropagation?: boolean
  /** told when the viewer opens or closes (callers that pause keyboard shortcuts meanwhile) */
  onOpenChange?: (open: boolean) => void
}) {
  const photos = gallery && gallery.length ? gallery : [{ src, alt, label }]
  const [index, setIndexRaw] = useState<number | null>(null)
  const setIndex = (i: number | null) => {
    if ((i === null) !== (index === null)) onOpenChange?.(i !== null)
    setIndexRaw(i)
  }
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation()
          setIndex(gallery && gallery.length ? Math.min(galleryIndex, photos.length - 1) : 0)
        }}
        onKeyDown={(e) => stopPropagation && e.stopPropagation()}
        className={cn('relative block cursor-zoom-in overflow-hidden rounded-lg bg-tile', className)}
        aria-label={`View ${alt} full screen`}
        title="Click to view full screen"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={cn('block size-full object-cover', imgClassName)} loading="lazy" />
        {label && (
          <span className="absolute bottom-2 left-2 rounded px-[7px] py-0.5 text-[11px] font-medium text-white" style={{ background: 'rgba(26,26,25,0.72)' }}>
            {label}
          </span>
        )}
      </button>
      {index !== null && (
        // the viewer renders in a portal; this wrapper only keeps its clicks and keys from reaching a clickable parent (a meal card).
        // `hidden` so it never becomes a grid or flex item of the thumbnail's container.
        <span className="hidden" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <PhotoLightbox photos={photos} index={index} onIndexChange={setIndex} onClose={() => setIndex(null)} />
        </span>
      )}
    </>
  )
}
