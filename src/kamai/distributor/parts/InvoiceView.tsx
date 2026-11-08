import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { Button, Spinner } from '../../ui'
import { supabase } from '../../lib/supabase'
import { PKR, fmtDate } from '../../lib/format'
import type { KamaiInvoiceItemsRow, KamaiInvoicesRow } from '../../lib/db-types'
import { ErrorState, useTq } from '../lib/data'
import { fbrReadiness, snap } from '../lib/fbr'

const PRINT_CSS = `
@media print {
  body > *:not(.k-print-portal) { display: none !important; }
  .k-print-portal { position: static !important; background: #fff !important; padding: 0 !important; overflow: visible !important; }
  .k-print-portal .k-no-print { display: none !important; }
  .k-print-sheet { box-shadow: none !important; border: 0 !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
  @page { size: A4; margin: 14mm; }
}`

/** Print-friendly invoice with tax lines and FBR placeholders. */
export function InvoiceView({ invoice, onClose }: { invoice: KamaiInvoicesRow | null; onClose: () => void }) {
  const items = useTq<KamaiInvoiceItemsRow[]>(['inv-items', invoice?.id], (t) => supabase.from('kamai_invoice_items').select('*').eq('tenant_id', t).eq('invoice_id', invoice!.id).order('line_no'), { enabled: !!invoice })
  useEffect(() => {
    if (!invoice) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [invoice, onClose])
  if (!invoice) return null
  const seller = snap(invoice.seller_snapshot)
  const buyer = snap(invoice.buyer_snapshot)
  const rd = fbrReadiness(invoice, items.data)
  const fbrNo = invoice.fbr_invoice_number

  return createPortal(
    <div className="kamai-root k-print-portal fixed inset-0 z-[950] overflow-y-auto bg-k-dark/55 p-2 sm:p-6">
      <style>{PRINT_CSS}</style>
      <div className="k-no-print mx-auto mb-3 flex max-w-3xl items-center justify-between gap-2">
        <Button icon={<Printer size={15} />} onClick={() => window.print()}>Print / Save PDF</Button>
        <Button variant="secondary" icon={<X size={15} />} onClick={onClose}>Close</Button>
      </div>
      <article className="k-print-sheet mx-auto max-w-3xl rounded-2xl border border-k-border bg-white p-5 text-k-text shadow-xl sm:p-8" style={{ color: '#0f2b22' }}>
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-k-dark pb-4">
          <div>
            <div className="text-xl font-extrabold">{seller.name ?? 'Seller'}</div>
            <div className="mt-1 text-xs leading-relaxed text-k-muted">
              {seller.address ?? ''}{seller.province ? `, ${seller.province}` : ''}<br />
              NTN: {seller.ntn ?? 'not set'} · STRN: {seller.strn ?? 'not set'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold uppercase tracking-[2px] text-k-muted">{invoice.invoice_type}</div>
            <div className="text-lg font-extrabold">{invoice.display_number}</div>
            <div className="text-xs text-k-muted">Date {fmtDate(invoice.invoice_date)}{invoice.due_date ? ` · Due ${fmtDate(invoice.due_date)}` : ''}</div>
            <div className="mt-1 text-xs font-semibold uppercase">{invoice.status}</div>
          </div>
        </header>
        <section className="grid gap-4 py-4 sm:grid-cols-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[1px] text-k-muted">Bill to</div>
            <div className="font-bold">{buyer.name ?? '—'}</div>
            <div className="text-xs text-k-muted">{buyer.address ?? ''}<br />{buyer.mobile ?? ''}<br />{invoice.buyer_registration_type}{invoice.buyer_ntn_cnic ? ` · NTN/CNIC ${invoice.buyer_ntn_cnic}` : ' · NTN/CNIC not provided'}</div>
          </div>
          <div className="flex items-start gap-3 sm:justify-end">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded border border-dashed border-k-border text-center text-[9px] leading-tight text-k-light">FBR QR<br />placeholder</div>
            <div className="text-xs">
              <div className="font-bold uppercase tracking-[1px] text-k-muted">FBR invoice no.</div>
              <div className="font-mono">{fbrNo ?? 'Pending submission'}</div>
              {invoice.fbr_status ? <div className="text-k-muted">Status: {invoice.fbr_status}</div> : null}
            </div>
          </div>
        </section>
        {items.isLoading ? <Spinner label="Loading lines…" /> : items.isError ? <ErrorState error={items.error} /> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-y border-k-dark text-left uppercase tracking-[0.5px]">
                  <th className="py-2 pr-2">#</th><th className="pr-2">Description</th><th className="pr-2">HS code</th><th className="pr-2 text-right">Qty</th><th className="pr-2 text-right">Rate</th>
                  <th className="pr-2 text-right">Excl. tax</th><th className="pr-2 text-right">Tax %</th><th className="pr-2 text-right">Sales tax</th><th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(items.data ?? []).map((i) => (
                  <tr key={i.id} className="border-b border-k-border align-top">
                    <td className="py-1.5 pr-2">{i.line_no}</td><td className="pr-2">{i.description}<div className="text-[10px] text-k-muted">{i.sale_type}</div></td>
                    <td className="pr-2">{i.hs_code ?? '—'}</td><td className="pr-2 text-right">{i.qty}</td><td className="pr-2 text-right">{PKR(i.unit_price_minor, { decimals: true })}</td>
                    <td className="pr-2 text-right">{PKR(i.value_excl_st_minor, { decimals: true })}</td><td className="pr-2 text-right">{i.tax_rate_pct}%</td>
                    <td className="pr-2 text-right">{PKR(i.sales_tax_minor, { decimals: true })}</td><td className="text-right font-semibold">{PKR(i.line_total_minor, { decimals: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <section className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><span>Value excl. sales tax</span><span>{PKR(invoice.total_excl_st_minor, { decimals: true })}</span></div>
          <div className="flex justify-between"><span>Sales tax</span><span>{PKR(invoice.sales_tax_minor, { decimals: true })}</span></div>
          {invoice.further_tax_minor ? <div className="flex justify-between"><span>Further tax</span><span>{PKR(invoice.further_tax_minor, { decimals: true })}</span></div> : null}
          {invoice.extra_tax_minor ? <div className="flex justify-between"><span>Extra tax</span><span>{PKR(invoice.extra_tax_minor, { decimals: true })}</span></div> : null}
          {invoice.discount_minor ? <div className="flex justify-between"><span>Discount</span><span>-{PKR(invoice.discount_minor, { decimals: true })}</span></div> : null}
          <div className="flex justify-between border-t-2 border-k-dark pt-1 text-base font-extrabold"><span>Total</span><span>{PKR(invoice.total_incl_minor, { decimals: true })}</span></div>
        </section>
        <footer className="mt-6 border-t border-k-border pt-3 text-[11px] text-k-muted">
          {seller.bank_iban ? <>Pay to IBAN {seller.bank_iban}{seller.raast_alias ? ` · Raast ${seller.raast_alias}` : ''}. </> : null}
          {!rd.ok ? <span className="k-no-print font-semibold text-k-red">FBR readiness: missing {rd.missing.join(', ')}.</span> : null}
        </footer>
      </article>
    </div>,
    document.body,
  )
}
