import { AlertTriangle } from 'lucide-react'
import { Button } from '../../ui'

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-k-red/30 bg-k-red-light px-4 py-8 text-center">
      <AlertTriangle className="text-k-red" size={24} />
      <div className="text-sm font-semibold text-k-red">{message}</div>
      {onRetry ? (
        <Button variant="secondary" size="md" onClick={onRetry}>
          Dobara koshish / Retry
        </Button>
      ) : null}
    </div>
  )
}
