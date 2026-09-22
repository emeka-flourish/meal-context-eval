'use client'
import { useEffect, useState } from 'react'

/* Tap a thumbnail → full-screen viewer (tap anywhere / Esc to close).
   Used for meal artifacts and ingest thumbnails — checking plate details
   while entering GT needs the full photo. */
export default function ZoomableImage({
  src,
  alt,
  thumbClass,
}: {
  src: string
  alt: string
  thumbClass: string
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    // stop body scroll behind the overlay
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block" aria-label={`View ${alt} full size`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={thumbClass} />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-2"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full bg-white/20 px-3 py-1.5 text-lg text-white"
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}
