export function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span className="block h-2 w-full min-w-[60px] overflow-hidden rounded-full bg-k-surface2">
      <span className="block h-full rounded-full bg-k-green" style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
    </span>
  )
}
