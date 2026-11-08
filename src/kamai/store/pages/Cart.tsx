import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ShoppingCart, Trash2 } from 'lucide-react'
import { Button, Card, CardTitle, EmptyState } from '../../ui'
import { PKR } from '../../lib/format'
import { useLang } from '../../lib/i18n'
import type { PaymentMode } from '../../lib/db-types'
import { useCart } from '../lib/cart'
import { daysOverdue, sumOutstanding, useCreditAccount, useExposures, useProducts, useStoreCtx, useStoreRow } from '../lib/data'
import { creditPreview, estimateTax } from '../lib/credit'
import { OrderSheet, PayModeToggle, type SheetLine } from '../lib/OrderSheet'
import { ErrorBox, Loading, ProductThumb, Stepper } from '../lib/parts'
import '../lib/strings'

export function Component() {
  const { t, lang } = useLang()
  const ctx = useStoreCtx()
  const store = useStoreRow(ctx)
  const products = useProducts(ctx, store.data?.price_list_id, !!store.data || !!store.error)
  const credit = useCreditAccount(ctx)
  const exposures = useExposures(ctx)
  const cart = useCart(ctx?.tenantId ?? null)
  const [mode, setMode] = useState<PaymentMode>('credit')
  const [sheet, setSheet] = useState(false)

  const rows = useMemo(() => {
    const m = new Map((products.data ?? []).map((p) => [p.id, p]))
    return Object.entries(cart.lines).flatMap(([id, qty]) => {
      const p = m.get(id)
      return p ? [{ p, qty }] : []
    })
  }, [products.data, cart.lines])

  // Drop cart lines whose product is gone or inactive once products have loaded.
  const { lines: cartLines, setQty } = cart
  useEffect(() => {
    if (!products.data) return
    const ids = new Set(products.data.map((p) => p.id))
    for (const id of Object.keys(cartLines)) if (!ids.has(id)) setQty(id, 0)
  }, [products.data, cartLines, setQty])

  const subtotal = rows.reduce((a, r) => a + r.qty * r.p.price_minor, 0)
  const tax = rows.reduce((a, r) => a + estimateTax(r.qty, r.p.price_minor, r.p.retail_price_minor, r.p.tax_rate_pct, r.p.is_third_schedule), 0)
  const total = subtotal + tax
  const outstanding = sumOutstanding(exposures.data)
  const hasOverdue = (exposures.data ?? []).some((e) => daysOverdue(e.due_date) > 0)
  const preview = creditPreview({ mode, total, acc: credit.data, outstanding, hasOverdue })

  const lines: SheetLine[] = rows.map((r) => ({
    product_id: r.p.id,
    name: lang === 'ur' && r.p.name_ur ? r.p.name_ur : r.p.name,
    qty: r.qty,
    unit_minor: r.p.price_minor,
  }))

  if (!ctx) return <Loading />
  if (products.isLoading || store.isLoading) return <Loading />
  if (products.error) return <ErrorBox error={products.error} onRetry={() => void products.refetch()} />

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingCart size={22} />}
        title={t('st_cart_empty')}
        description={t('st_cart_empty_d')}
        action={
          <Link to="/store/catalog">
            <Button size="lg">{t('st_open_catalog')}</Button>
          </Link>
        }
      />
    )
  }

  const tone = preview?.tone === 'ok' ? 'text-k-green bg-k-green-light' : preview?.tone === 'warn' ? 'text-[#8a5a00] bg-[#fff8e6]' : 'text-k-muted bg-k-surface2'

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {rows.map(({ p, qty }) => (
          <li key={p.id}>
            <Card padding="sm" className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <ProductThumb url={p.image_url} name={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-bold text-k-dark">{lang === 'ur' && p.name_ur ? p.name_ur : p.name}</div>
                  <div className="text-xs text-k-muted">
                    {PKR(p.price_minor)} × {qty}
                  </div>
                </div>
                <div className="text-base font-extrabold text-k-dark">{PKR(qty * p.price_minor)}</div>
              </div>
              <div className="flex items-center justify-between">
                <Stepper qty={qty} onChange={(n) => cart.setQty(p.id, n)} />
                <Button variant="ghost" size="md" icon={<Trash2 size={16} />} onClick={() => cart.setQty(p.id, 0)}>
                  {t('st_remove')}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Card>
        <CardTitle>{t('st_pay_mode')}</CardTitle>
        <PayModeToggle value={mode} onChange={setMode} />
        {preview ? (
          <div className={`mt-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold ${tone}`}>
            <span className="mr-1 font-extrabold">{t('st_decision')}:</span>
            {t(preview.key, preview.vars)}
          </div>
        ) : null}
        {credit.error ? <div className="mt-3"><ErrorBox error={credit.error} /></div> : null}
      </Card>

      <Card>
        <div className="flex justify-between py-1 text-sm text-k-muted">
          <span>{t('subtotal')}</span>
          <span className="font-semibold text-k-dark">{PKR(subtotal)}</span>
        </div>
        <div className="flex justify-between py-1 text-sm text-k-muted">
          <span>{t('st_tax_est')}</span>
          <span className="font-semibold text-k-dark">{PKR(tax)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-k-border pt-3 text-lg font-extrabold text-k-dark">
          <span>{t('total')}</span>
          <span>{PKR(total)}</span>
        </div>
      </Card>

      <Button size="lg" block className="h-14 text-lg" onClick={() => setSheet(true)}>
        {t('place_order')}
      </Button>
      <Button variant="ghost" block onClick={cart.clear}>
        {t('st_clear')}
      </Button>

      <OrderSheet open={sheet} onClose={() => setSheet(false)} ctx={ctx} lines={lines} mode={mode} onDone={cart.clear} />
    </div>
  )
}
