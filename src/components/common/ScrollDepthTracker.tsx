'use client'

import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

const THRESHOLDS = [25, 50, 75, 100] as const

export default function ScrollDepthTracker() {
  const firedRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      if (docHeight <= 0) return

      const scrollPercent = Math.round((scrollTop / docHeight) * 100)

      THRESHOLDS.forEach((threshold) => {
        if (scrollPercent >= threshold && !firedRef.current.has(threshold)) {
          firedRef.current.add(threshold)

          window.gtag?.('event', 'scroll_depth', {
            event_category: 'Engagement',
            event_label: `${threshold}%`,
            scroll_threshold: threshold,
          })
        }
      })
    }

    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  return null
}
