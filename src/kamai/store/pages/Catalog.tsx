import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Search } from 'lucide-react'
import { Card, EmptyState, Input, cx } from '../../ui'
import { PKR, fmtInt } from '../../lib/format'
import { useLang } from '../../lib/i18n'
import { useCart } from '../lib/cart'
import { useProducts, useStoreCtx, useStoreRow } from '../lib/data'
import { ErrorBox, Loading, ProductThumb, Stepper } from '../lib/parts'
import '../lib/strings'

export function Component() {
  const { t, lang } = useLang()
  const ctx = useStoreCtx()
  const store = useStoreRow(ctx)
  const products = useProducts(ctx, store.data?.price_list_id, !!store.data || !!store.error)
  const cart = useCart(ctx?.tenantId ?? null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('')

  const cats = useMemo(() => Array.from(new Set((products.data ?? []).map((p) => p.category).filter((c): c is string => !!c))).sort(), [products.data])
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (products.data ?? []).filter((p) => {
      if (cat && p.category !== cat) return false
      if (!needle) return true
      return [p.name, p.name_ur ?? '', p.sku, p.pack_size ?? ''].some((s) => s.toLowerCase().includes(needle))
    })
  }, [products.data, q, cat])

  const total = useMemo(() => {
    const m = new Map((products.data ?? []).map((p) => [p.id, p.price_minor]))
    return Object.entries(cart.lines).reduce((a, [id, qty]) => a + (m.get(id) ?? 0) * qty, 0)
  }, [products.data, cart.lines])

  if (!ctx) return <Loading />

  return (
    <div className="flex flex-col gap-3 pb-20">
      <Input size="lg" placeholder={t('st_search_ph')} value={q} onChange={(e) => setQ(e.target.value)} prefix={<Search size={16} />} inputMode="search" />
      {cats.length > 0 ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {['', ...cats].map((c) => (
            <button
              key={c || 'all'}
              type="button"
              onClick={() => setCat(c)}
              className={cx(
                'h-10 shrink-0 rounded-full border px-4 text-[13px] font-bold',
                cat === c ? 'border-k-green bg-k-green text-white' : 'border-k-border bg-k-surface text-k-muted',
              )}
            >
              {c || t('st_all')}
            </button>
          ))}
        </div>
      ) : null}

      {products.isLoading || store.isLoading ? (
        <Loading />
      ) : products.error ? (
        <ErrorBox error={products.error} onRetry={() => void products.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title={t('st_no_products')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((p) => (
            <li key={p.id}>
              <Card padding="sm" className="flex items-center gap-3">
                <ProductThumb url={p.image_url} name={p.name} size={72} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-bold leading-snug text-k-dark">{lang === 'ur' && p.name_ur ? p.name_ur : p.name}</div>
                  {p.pack_size ? <div className="text-xs text-k-muted">{p.pack_size}</div> : null}
                  <div className="mt-1 text-base font-extrabold text-k-green">{PKR(p.price_minor)}</div>
                </div>
                <Stepper qty={cart.lines[p.id] ?? 0} onChange={(n) => cart.setQty(p.id, n)} addLabel={t('st_add')} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {cart.kinds > 0 ? (
        <Link
          to="/store/cart"
          className="fixed inset-x-4 z-20 mx-auto flex max-w-2xl items-center justify-between rounded-2xl bg-k-green px-5 py-4 text-white shadow-lg"
          style={{ bottom: 'calc(84px + env(safe-area-inset-bottom))' }}
        >
          <span className="text-sm font-bold">
            {t('st_view_cart')} · {t('st_items', { n: fmtInt(cart.kinds) })}
          </span>
          <span className="text-base font-extrabold">{PKR(total)}</span>
        </Link>
      ) : null}
    </div>
  )
}
