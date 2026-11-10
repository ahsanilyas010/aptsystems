import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'

export interface SignaturePadHandle {
  isEmpty: () => boolean
  clear: () => void
  toBlob: () => Promise<Blob | null>
}

export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (empty: boolean) => void }>(function SignaturePad({ onChange }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const empty = useRef(true)

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth
    c.width = w * dpr
    c.height = 160 * dpr
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.strokeStyle = '#111'
    }
  }, [])

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  useImperativeHandle(ref, () => ({
    isEmpty: () => empty.current,
    clear: () => {
      const c = canvas.current
      c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
      empty.current = true
      onChange?.(true)
    },
    toBlob: () => new Promise((res) => (canvas.current && !empty.current ? canvas.current.toBlob((b) => res(b), 'image/png') : res(null))),
  }))

  return (
    <canvas
      ref={canvas}
      aria-label="Signature pad"
      className="h-40 w-full touch-none rounded-xl border border-dashed border-k-border bg-white"
      onPointerDown={(e) => {
        drawing.current = true
        canvas.current?.setPointerCapture(e.pointerId)
        const ctx = canvas.current?.getContext('2d')
        const p = pos(e)
        ctx?.beginPath()
        ctx?.moveTo(p.x, p.y)
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return
        const ctx = canvas.current?.getContext('2d')
        const p = pos(e)
        ctx?.lineTo(p.x, p.y)
        ctx?.stroke()
        if (empty.current) {
          empty.current = false
          onChange?.(false)
        }
      }}
      onPointerUp={() => {
        drawing.current = false
      }}
      onPointerCancel={() => {
        drawing.current = false
      }}
    />
  )
})
