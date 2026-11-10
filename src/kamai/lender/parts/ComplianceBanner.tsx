import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useFacilities } from '../lib/data'

/** Always-visible compliance notice: lender of record, debtor of record, KFS reminder. */
export function ComplianceBanner() {
  const { ctx, activeTenantId } = useAuth()
  const lender = ctx.memberships.find((m) => m.tenant_id === activeTenantId)?.tenant.name ?? 'your lender tenant'
  const { data: facilities } = useFacilities()
  const debtors = [...new Set((facilities ?? []).map((f) => (f.debtor_of_record === 'store' ? 'the retail store' : 'the distributor')))]
  return (
    <div role="note" className="mb-6 flex gap-3 rounded-2xl border border-[#f0d58a] bg-[#fff8e6] p-4 text-[13px] text-[#6b4b00]">
      <ShieldAlert size={20} className="mt-0.5 shrink-0" />
      <div className="space-y-1">
        <div className="font-bold">Compliance notice</div>
        <p>
          <b>Lender of record:</b> {lender}. <b>Debtor of record:</b> {debtors.length ? debtors.join(' / ') : 'set per facility'}. Kamai is the platform and
          seller only: it never lends, never books finance charges and never holds repayments as its own float.
        </p>
        <p>
          <b>KFS reminder:</b> issue the Key Facts Statement to the borrower before every disbursement, and keep the signed copy on file. Financed states
          require the legal perimeter and data residency clearances to be in place.
        </p>
      </div>
    </div>
  )
}
