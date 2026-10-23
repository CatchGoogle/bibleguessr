import { useLayoutEffect, useRef, useState } from 'react'
import { searchFit } from '../lib/fitText.ts'

// Shrinks the quote until its words fit the box. A phone passage that still
// overflows at the smallest size is allowed to grow so the last words stay visible.
export function FittedQuote({
  text,
  max,
  min,
  className,
}: {
  text: string
  max: number
  min: number
  className?: string
}) {
  const ref = useRef<HTMLQuoteElement>(null)
  const [fit, setFit] = useState({ size: max, uncap: false })

  useLayoutEffect(() => {
    const el = ref.current
    const box = el?.parentElement
    if (!el || !box) return

    const apply = () => {
      const next = measureQuote(el, max, min)
      setFit((current) => (current.size === next.size && current.uncap === next.uncap ? current : next))
    }

    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(box)
    return () => observer.disconnect()
  }, [text, max, min])

  return (
    <blockquote
      ref={ref}
      className={className}
      style={{
        fontSize: fit.size,
        ...(fit.uncap ? { maxHeight: 'none', overflow: 'visible' } : null),
      }}
    >
      {text}
    </blockquote>
  )
}

function measureQuote(el: HTMLElement, maxPx: number, minPx: number) {
  const inlineMax = el.style.maxHeight
  const inlineFont = el.style.fontSize
  el.style.maxHeight = ''
  const cap = getComputedStyle(el).maxHeight
  const budget = cap.endsWith('px') ? parseFloat(cap) : el.clientHeight
  el.style.maxHeight = inlineMax

  const next = searchFit(maxPx, minPx, (px) => {
    el.style.fontSize = `${px}px`
    return el.scrollHeight <= budget + 2
  })
  el.style.fontSize = inlineFont
  return next
}
