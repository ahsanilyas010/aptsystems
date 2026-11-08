import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Button, Card, CardTitle, cx, useToast } from '../../ui'
import { PKR, fmtDate, maskMobile } from '../../lib/format'
import { LANGS, useLang } from '../../lib/i18n'
import { useCreditAccount, useOrders, useStoreCtx, useStoreRow, useTenantRow } from '../lib/data'
import { InstallBanner } from '../lib/InstallBanner'
import { ErrorBox, Loading, Row } from '../lib/parts'
import '../lib/strings'

export function Component() {
  const { t, lang, setLang } = useLang()
  const { signOut, user } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const ctx = useStoreCtx()
  const store = useStoreRow(ctx)
  const tenant = useTenantRow(ctx)
  const credit = useCreditAccount(ctx)
  const orders = useOrders(ctx)

  const optIn = !!store.data?.wa_opt_in_at
  const wa = useMutation({
    mutationFn: async (on: boolean) => {
      const { data, error } = await supabase
        .from('kamai_stores')
        .update({ wa_opt_in_at: on ? new Date().toISOString() : null, wa_opt_in_source: on ? 'store_pwa' : null })
        .eq('tenant_id', ctx!.tenantId)
        .eq('id', ctx!.storeId)
        .select('id')
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) throw new Error(t('st_wa_fail'))
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['kamai-store', 'store'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const logout = async () => {
    await signOut()
    nav('/auth/login', { replace: true })
  }

  if (!ctx || store.isLoading) return <Loading />
  const s = store.data

  return (
    <div className="flex flex-col gap-4">
      <InstallBanner hasOrders={(orders.data?.length ?? 0) > 0} />

      <Card>
        <CardTitle>{t('st_store_details')}</CardTitle>
        {store.error ? (
          <ErrorBox error={store.error} onRetry={() => void store.refetch()} />
        ) : !s ? (
          <p className="text-sm text-k-muted">{t('st_no_store')}</p>
        ) : (
          <div className="divide-y divide-k-border">
            <Row label={t('st_title')}>{s.name}</Row>
            {s.owner_name ? <Row label={t('st_owner')}>{s.owner_name}</Row> : null}
            <Row label={t('mobile')}>{maskMobile(s.mobile || user?.phone)}</Row>
            {s.address || s.area ? <Row label={t('st_address')}>{[s.address, s.area].filter(Boolean).join(', ')}</Row> : null}
            <Row label={t('st_distributor')}>{tenant.data?.name ?? '—'}</Row>
            <Row label={t('st_terms')}>{t('st_days', { n: s.payment_terms_days })}</Row>
            <Row label={t('credit_limit')}>{credit.data ? PKR(credit.data.limit_minor) : PKR(s.credit_limit_minor)}</Row>
            <Row label="Ref">{s.payment_ref_code}</Row>
            <Row label="Since">{fmtDate(s.created_at)}</Row>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>{t('language')}</CardTitle>
        <div className="grid grid-cols-3 gap-2">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLang(l.code)}
              className={cx(
                'h-12 rounded-xl border-2 text-sm font-bold',
                lang === l.code ? 'border-k-green bg-k-green-light text-k-green' : 'border-k-border bg-k-surface text-k-muted',
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-bold text-k-dark">{t('st_wa')}</div>
            <p className="text-xs text-k-muted">{t('st_wa_d')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={optIn}
            disabled={wa.isPending || !s}
            onClick={() => wa.mutate(!optIn)}
            className={cx('relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-60', optIn ? 'bg-k-green' : 'bg-k-border')}
          >
            <span className={cx('absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all', optIn ? 'left-7' : 'left-1')} />
          </button>
        </div>
      </Card>

      <Button size="lg" variant="secondary" block icon={<LogOut size={18} />} onClick={() => void logout()}>
        {t('st_signout')}
      </Button>
    </div>
  )
}
