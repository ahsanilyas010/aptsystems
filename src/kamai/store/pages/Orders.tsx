import { Link } from 'react-router'
import { ChevronRight, ClipboardList } from 'lucide-react'
import { Badge, Button, Card, EmptyState, statusTone } from '../../ui'
import { PKR, fmtDate } from '../../lib/format'
import { useLang } from '../../lib/i18n'
import { useOrders, useStoreCtx } from '../lib/data'
import { useQueue } from '../lib/offline-queue'
import { ErrorBox, Loading } from '../lib/parts'
import '../lib/strings'

export function Component() {
  const { t } = useLang()
  const ctx = useStoreCtx()
  const orders = useOrders(ctx)
  const { jobs } = useQueue()

  if (!ctx || orders.isLoading) return <Loading />

  return (
    <div className="flex flex-col gap-3">
      {jobs.length > 0 ? (
        <Card tone="muted" padding="sm" className="text-[13px] font-semibold text-k-dark">
          {t('st_queued')}
        </Card>
      ) : null}
      {orders.error ? (
        <ErrorBox error={orders.error} onRetry={() => void orders.refetch()} />
      ) : (orders.data ?? []).length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={22} />}
          title={t('st_no_orders')}
          action={
            <Link to="/store/catalog">
              <Button size="lg">{t('st_open_catalog')}</Button>
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(orders.data ?? []).map((o) => (
            <li key={o.id}>
              <Link to={`/store/orders/${o.id}`}>
                <Card padding="sm" className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-extrabold text-k-dark">{t('st_order_no', { no: o.order_no })}</span>
                      <Badge tone={statusTone(o.fulfilment_status)} dot>
                        {t(`st_s_${o.fulfilment_status}`)}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-k-muted">
                      {fmtDate(o.created_at)} · {t('st_items', { n: o.items_count })} · {o.payment_mode === 'cod' ? t('st_cod') : t('st_credit')}
                    </div>
                  </div>
                  <div className="text-base font-extrabold text-k-dark">{PKR(o.total_minor)}</div>
                  <ChevronRight size={18} className="text-k-light" />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
