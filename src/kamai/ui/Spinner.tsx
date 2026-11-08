import { cx } from './cx'

export interface SpinnerProps {
  size?: number
  className?: string
  /** full-area centered spinner with optional label */
  label?: string
}

export function Spinner({ size = 20, className, label }: SpinnerProps) {
  const ring = (
    <span
      role="status"
      aria-label={label ?? 'Loading'}
      className={cx('inline-block rounded-full border-current border-t-transparent', className)}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 8)), animation: 'kamai-spin 0.8s linear infinite', opacity: 0.8 }}
    />
  )
  if (!label) return ring
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-k-muted">
      {ring}
      <span className="text-sm font-medium">{label}</span>
    </div>
  )
}
