'use client'

import { useEffect } from 'react'

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

export default function CtaTracker() {
  useEffect(() => {
    const ctaElements = document.querySelectorAll('.harmony-cta')

    if (ctaElements.length === 0) return

    // Track CTA views with Intersection Observer
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const target = entry.target as HTMLElement
            const position = target.dataset.ctaPosition || 'unknown'

            window.gtag?.('event', 'cta_view', {
              event_category: 'CTA',
              event_label: position,
              cta_position: position,
            })

            // Stop observing after first view
            observer.unobserve(target)
          }
        })
      },
      { threshold: 0.5 }
    )

    ctaElements.forEach((el) => observer.observe(el))

    // Track CTA clicks
    const handleClick = (e: Event) => {
      const target = (e.currentTarget as HTMLElement)
      const position = target.dataset.ctaPosition || 'unknown'

      window.gtag?.('event', 'cta_click', {
        event_category: 'CTA',
        event_label: position,
        cta_position: position,
      })
    }

    ctaElements.forEach((el) => {
      el.addEventListener('click', handleClick)
    })

    return () => {
      observer.disconnect()
      ctaElements.forEach((el) => {
        el.removeEventListener('click', handleClick)
      })
    }
  }, [])

  return null
}
