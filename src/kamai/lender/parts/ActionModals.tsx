import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Modal, Select, useToast } from '../../ui'
import { supabase } from '../../lib/supabase'
import { useActiveMembership } from '../../lib/auth'
import { PKR } from '../../lib/format'
import { toMinor } from '../../lib/money'
import type { KamaiFacilitiesRow, KamaiFinancingsRow, KamaiVLenderPositionsRow } from '../../lib/db-types'
import { errMsg } from '../lib/data'

/** Lender owner/manager may act (the RPC also enforces this server side). */
export function useCanAct(): boolean {
  const m = useActiveMembership()
  return !!m && (m.role === 'owner' || m.role === 'manager')
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['lender'] })
}

export function FinanceModal({
  row,
  facilities,
  onClose,
}: {
  row: KamaiVLenderPositionsRow | null
  facilities: KamaiFacilitiesRow[]
  onClose: () => void
}) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const options = facilities.filter((f) => f.status === 'active' && f.borrower_tenant_id === row?.distributor_tenant_id)
  const [fid, setFid] = useState('')
  const facility = options.find((f) => f.id === (fid || options[0]?.id))
  const advance = row && facility ? Math.round(((row.outstanding_minor ?? 0) * facility.advance_rate_pct) / 100) : 0

  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('kamai_finance_order', { p_order_id: row?.order_id, p_facility_id: facility?.id })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success('Order financed')
      invalidate()
      onClose()
    },
    onError: (e) => toast.error(errMsg(e)),
  })

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title="Finance this order"
      description={row ? `${row.store_name ?? 'Store'} · invoice ${row.invoice_number ?? '—'}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} disabled={!facility} onClick={() => m.mutate()}>
            Disburse {PKR(advance)}
          </Button>
        </>
      }
    >
      {options.length === 0 ? (
        <p className="text-sm text-k-muted">No active facility for this distributor. Ask Kamai to activate a facility before financing.</p>
      ) : (
        <div className="space-y-4">
          <Select
            label="Facility"
            value={facility?.id ?? ''}
            onChange={(e) => setFid(e.target.value)}
            options={options.map((f) => ({ value: f.id, label: `${f.technique.replace(/_/g, ' ')} · ${f.advance_rate_pct}% advance` }))}
          />
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-k-muted">Receivable outstanding</dt>
            <dd className="text-right font-bold">{PKR(row?.outstanding_minor)}</dd>
            <dt className="text-k-muted">Advance ({facility?.advance_rate_pct}%)</dt>
            <dd className="text-right font-bold">{PKR(advance)}</dd>
            <dt className="text-k-muted">Debtor of record</dt>
            <dd className="text-right font-bold capitalize">{facility?.debtor_of_record}</dd>
          </dl>
          <p className="rounded-lg bg-[#fff8e6] p-3 text-xs text-[#6b4b00]">Confirm the Key Facts Statement has been issued to the borrower before disbursing.</p>
        </div>
      )}
    </Modal>
  )
}

export function SettleModal({ financing, onClose }: { financing: KamaiFinancingsRow | null; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [amount, setAmount] = useState('')
  const remaining = financing ? financing.disbursed_minor - financing.repaid_minor : 0
  const minor = toMinor(amount)
  const bad = minor <= 0 || minor > remaining

  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('kamai_settle_financing', { p_financing_id: financing?.id, p_amount_minor: minor })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success('Settlement recorded')
      setAmount('')
      invalidate()
      onClose()
    },
    onError: (e) => toast.error(errMsg(e)),
  })

  return (
    <Modal
      open={!!financing}
      onClose={onClose}
      title="Record settlement"
      description={`Outstanding on this advance: ${PKR(remaining)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} disabled={bad} onClick={() => m.mutate()}>
            Record {minor > 0 ? PKR(minor) : ''}
          </Button>
        </>
      }
    >
      <Input
        label="Amount received (Rs)"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={amount && bad ? `Enter between Rs 1 and ${PKR(remaining)}` : undefined}
        hint={<button type="button" className="font-bold text-k-green" onClick={() => setAmount(String(remaining / 100))}>Fill full outstanding</button>}
      />
    </Modal>
  )
}
