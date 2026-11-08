import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight, Truck } from 'lucide-react'
import { Badge, Button, Card, CardTitle, EmptyState, Stat, statusTone } from '../../ui'
import { PKR, fmtDate } from '../../lib/format'
import { useLang } from '../../lib/i18n'
import {
  daysOverdue,
  sumOutstanding,
  useCreditAccount,
  useExposures,
  useInvoiceMap,
  useOrderItems,
  useOrders,
  useProducts,
  useStoreCtx,
  useStoreRow,
} from '../lib/data'
import { availableCredit } from '../lib/credit'
import { OrderSheet, type SheetLine } from '../lib/OrderSheet'
import { InstallBanner } from '../lib/InstallBanner'
import { ErrorBox, Loading, ProductThumb } from '../lib/parts'
import '../lib/strings'

export function Component() {
  const { t, lang } = useLang()
  const ctx = useStoreCtx()
  const store = useStoreRow(ctx)
  const orders = useOrders(ctx)
  const credit = useCreditAccount(ctx)
  const exposures = useExposures(ctx)
  const products = useProducts(ctx, store.data?.price_list_id, !!store.data)
  const [sheet, setSheet] = useState(false)

  const last = useMemo(() => (orders.data ?? []).find((o) => o.fulfilment_status !== 'cancelled' && o.fulfilment_status !== 'rejected'), [orders.data])
  const active = useMemo(() => (orders.data ?? []).find((o) => ['booked', 'credit_approved', 'packed', 'dispatched'].includes(o.fulfilment_status)), [orders.data])
  const lastItems = useOrderItems(ctx, last?.id)
  const dueInvoiceIds = useMemo(() => (exposures.data ?? []).map((e) => e.invoice_id).filter((x): x is string => !!x), [exposures.data])
  const invMap = useInvoiceMap(ctx, dueInvoiceIds)

  const pmap = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data])
  const sheetLines = useMemo<SheetLine[]>(
    () =>
      (lastItems.data ?? []).flatMap((i) => {
        const p = pmap.get(i.product_id)
        if (!p) return []
        return [{ product_id: i.product_id, name: lang === 'ur' && p.name_ur ? p.name_ur : i.name, qty: i.qty, unit_minor: p.price_minor }]
      }),
    [lastItems.data, pmap, lang],
  )

  if (!ctx) return <Loading />
  const outstanding = sumOutstanding(exposures.data)
  const nextDue = (exposures.data ?? [])[0]
  const overdueDays = daysOverdue(nextDue?.due_date)
  const nextInv = nextDue?.invoice_id ? invMap.data?.[nextDue.invoice_id] : undefined
  const acc = credit.data

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold text-k-dark">{t('st_hello', { name: store.data?.owner_name || store.data?.name || '' })}</h1>

      <InstallBanner hasOrders={(orders.data?.length ?? 0) > 0} />

      {active && active.id !== last?.id ? null : null}
      {active ? (
        <Link to={`/store/orders/${active.id}`} className="block">
          <Card padding="sm" className="flex items-center gap-3">
            <Truck className="text-k-green" size={22} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-k-dark">{t('st_active_order')} · {t('st_order_no', { no: active.order_no })}</div>
              <Badge tone={statusTone(active.fulfilment_status)} dot>
                {t(`st_s_${active.fulfilment_status}`)}
              </Badge>
            </div>
            <ChevronRight size={18} className="text-k-light" />
          </Card>
        </Link>
      ) : null}

      <Card>
        <CardTitle>{t('st_last_order')}</CardTitle>
        {orders.isLoading || store.isLoading ? (
          <Loading />
        ) : orders.error ? (
          <ErrorBox error={orders.error} onRetry={() => void orders.refetch()} />
        ) : !last ? (
          <EmptyState
            compact
            title={t('st_no_orders')}
            description={t('st_no_last')}
            action={
              <Link to="/store/catalog">
                <Button size="lg">{t('st_open_catalog')}</Button>
              </Link>
            }
          />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between text-[13px] text-k-muted">
              <span>
                {t('st_order_no', { no: last.order_no })} · {fmtDate(last.created_at)}
              </span>
              <Badge tone={statusTone(last.fulfilment_status)}>{t(`st_s_${last.fulfilment_status}`)}</Badge>
            </div>
            {lastItems.isLoading ? (
              <Loading />
            ) : lastItems.error ? (
              <ErrorBox error={lastItems.error} />
            ) : (
              <ul className="mb-4 flex flex-col gap-2">
                {(lastItems.data ?? []).map((i) => (
                  <li key={i.id} className="flex items-center gap-3">
                    <ProductThumb url={pmap.get(i.product_id)?.image_url} name={i.name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-k-dark">{lang === 'ur' && pmap.get(i.product_id)?.name_ur ? pmap.get(i.product_id)!.name_ur : i.name}</div>
                      <div className="text-xs text-k-muted">{pmap.get(i.product_id)?.pack_size ?? ''}</div>
                    </div>
                    <div className="text-lg font-extrabold text-k-dark">×{i.qty}</div>
                  </li>
                ))}
              </ul>
            )}
            <Button size="lg" block className="h-14 text-lg" disabled={sheetLines.length === 0} onClick={() => setSheet(true)}>
              {t('st_reorder')}
            </Button>
          </>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Stat
          tone={outstanding > 0 ? 'dark' : 'light'}
          label={t('st_outstanding')}
          value={exposures.error ? '—' : PKR(outstanding)}
          sub={exposures.isLoading ? t('loading') : undefined}
        />
        <Stat
          tone="green"
          label={t('st_credit_avail')}
          value={credit.error || !acc ? '—' : PKR(availableCredit(acc, outstanding))}
          sub={acc ? t('st_of_limit', { limit: PKR(acc.limit_minor) }) : undefined}
        />
      </div>
      {credit.error ? <ErrorBox error={credit.error} onRetry={() => void credit.refetch()} /> : null}
      {acc && acc.status !== 'active' ? <Card tone="muted" padding="sm" className="text-[13px] text-k-red">{t('st_credit_off', { status: acc.status.replace('_', ' ') })}</Card> : null}

      <Card>
        <CardTitle dot={overdueDays > 0 ? 'red' : 'green'} action={outstanding > 0 ? <Link to="/store/pay" className="text-xs font-bold text-k-green">{t('st_pay_now')}</Link> : undefined}>
          {t('st_next_due')}
        </CardTitle>
        {exposures.isLoading ? (
          <Loading />
        ) : exposures.error ? (
          <ErrorBox error={exposures.error} onRetry={() => void exposures.refetch()} />
        ) : !nextDue ? (
          <p className="text-sm text-k-muted">{t('st_no_due')}</p>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-k-dark">{nextInv?.display_number ?? t('st_order_no', { no: '' })}</div>
              <div className={overdueDays > 0 ? 'text-xs font-semibold text-k-red' : 'text-xs text-k-muted'}>
                {overdueDays > 0 ? t('st_overdue_by', { n: overdueDays }) : t('st_due_on', { date: fmtDate(nextDue.due_date) })}
              </div>
            </div>
            <div className="text-lg font-extrabold text-k-dark">{PKR(nextDue.outstanding_minor)}</div>
          </div>
        )}
      </Card>

      {ctx ? <OrderSheet open={sheet} onClose={() => setSheet(false)} ctx={ctx} lines={sheetLines} /> : null}
    </div>
  )
}
