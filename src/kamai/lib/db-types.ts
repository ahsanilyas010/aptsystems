// Kamai OS database types (hand-written to match supabase/migrations/20261108120001..8).
// Conventions: snake_case fields as returned by PostgREST; bigint columns (minor units, paisa) are typed
// as number (safe below 2^53); timestamptz/date are ISO strings; jsonb is Json.
// Keep in sync with the migrations; see docs/KAMAI_DB.md.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// ---------------------------------------------------------------------------
// string-literal unions
// ---------------------------------------------------------------------------
export type TenantType = 'platform' | 'distributor' | 'brand' | 'lender' | 'vertical'
export type TenantStatus = 'active' | 'suspended' | 'archived'
export type MembershipRole = 'owner' | 'manager' | 'booker' | 'finance' | 'viewer' | 'rider' | 'store'
export type MembershipStatus = 'invited' | 'active' | 'disabled'
export type TenantLinkKind = 'lender_view' | 'brand_view' | 'supplier'
export type PriceTier = 'A' | 'B' | 'C' | 'default'
export type CreditStatus = 'cash_only' | 'active' | 'paused' | 'frozen' | 'written_off'
export type StoreStatus = 'active' | 'inactive' | 'blocked'
export type OrderSource = 'store_pwa' | 'whatsapp' | 'booker' | 'hero_app' | 'import'
export type FulfilmentStatus = 'booked' | 'credit_approved' | 'packed' | 'dispatched' | 'delivered' | 'cancelled' | 'rejected' | 'disputed'
export type FinanceStatus = 'unfinanced' | 'financed' | 'paid' | 'settled'
export type PaymentMode = 'credit' | 'cod'
export type DeliveryStatus = 'full' | 'partial' | 'refused'
export type InvoiceType = 'Sale Invoice' | 'Debit Note' | 'Credit Note'
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void'
export type LedgerAccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'contra'
export type LedgerSide = 'debit' | 'credit'
export type CreditDecisionKind = 'approved' | 'declined' | 'hold' | 'cod'
export type CreditReasonCode =
  | 'COD' | 'CASH_ONLY' | 'STORE_PAUSED' | 'STORE_FROZEN' | 'TENANT_PAUSED' | 'DPD_OVER_LIMIT'
  | 'LIMIT_EXCEEDED' | 'TENANT_CAP' | 'STORE_CAP'
export type ExposureStatus = 'open' | 'paid' | 'restructured' | 'written_off'
export type PaymentChannel = 'cash' | 'raast' | 'ibft' | 'easypaisa' | 'jazzcash' | 'cheque' | 'rtp'
export type PaymentStatus = 'recorded' | 'matched' | 'verified' | 'rejected'
export type BankMatchStatus = 'unmatched' | 'auto' | 'manual' | 'ignored'
export type FacilityTechnique =
  | 'retailer_purchase_loan' | 'receivables_discounting_recourse' | 'receivables_discounting_non_recourse'
  | 'payables_finance' | 'distributor_finance'
export type FacilityStatus = 'draft' | 'active' | 'suspended' | 'closed'
export type FinancingStatus = 'disbursed' | 'partially_repaid' | 'settled' | 'defaulted'
export type WaMessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received'
export type WaCategory = 'utility' | 'marketing' | 'authentication' | 'service'
export type DpdBucket = 'current' | '1-7' | '8-14' | '15-30' | '31-60' | '61-90' | '90+'
export type OtpError = 'OTP_INVALID' | 'OTP_EXPIRED' | 'OTP_LOCKED'
export type CashDepositMethod = 'bank' | 'office' | 'raast' | 'other'

// ---------------------------------------------------------------------------
// table rows
// ---------------------------------------------------------------------------

export interface KamaiAuditLogRow {
  id: number
  table_name: string
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  record_id: string | null
  tenant_id: string | null
  actor: string | null
  changed_keys: string[] | null
  old_row: Json | null
  new_row: Json | null
  at: string
}

export interface KamaiBankLinesRow {
  id: string
  tenant_id: string
  statement_id: string
  line_no: number
  line_date: string
  narration: string | null
  amount_minor: number
  direction: 'credit' | 'debit'
  bank_ref: string | null
  extracted_ref: string | null
  match_status: BankMatchStatus
  matched_payment_id: string | null
  matched_at: string | null
  matched_by: string | null
  meta: Json
  created_at: string
}

export interface KamaiBankStatementsRow {
  id: string
  tenant_id: string
  bank_name: string | null
  account_ref: string | null
  period_start: string | null
  period_end: string | null
  file_name: string | null
  file_hash: string
  rows_total: number
  imported_by: string | null
  created_at: string
}

export interface KamaiCashDepositsRow {
  id: string
  tenant_id: string
  rider_user_id: string
  business_date: string
  expected_minor: number
  deposited_minor: number
  method: 'bank' | 'office' | 'raast' | 'other'
  deposit_ref: string | null
  slip_url: string | null
  variance_minor: number
  status: 'open' | 'submitted' | 'reconciled' | 'variance'
  notes: string | null
  ledger_entry_id: string | null
  post_version: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface KamaiCountersRow {
  tenant_id: string
  kind: string
  value: number
  updated_at: string
}

export interface KamaiCreditAccountsRow {
  store_id: string
  tenant_id: string
  tier: number
  floor_tier: number
  limit_minor: number
  tenor_days: number
  status: CreditStatus
  policy_id: string | null
  reason_codes: string[]
  last_reviewed_at: string | null
  tier_changed_at: string | null
  updated_at: string
}

export interface KamaiCreditDecisionsRow {
  id: string
  tenant_id: string
  order_id: string
  store_id: string
  decision: CreditDecisionKind
  available_minor: number
  exposure_minor: number
  order_total_minor: number
  reason_codes: string[]
  policy_id: string | null
  decided_by: string | null
  decided_at: string
}

export interface KamaiCreditEventsRow {
  id: number
  tenant_id: string
  store_id: string
  event_type: string
  from_status: string | null
  to_status: string | null
  from_tier: number | null
  to_tier: number | null
  rule_id: string | null
  evidence: Json
  actor: string | null
  created_at: string
}

export interface KamaiCreditExposuresRow {
  id: string
  tenant_id: string
  store_id: string
  order_id: string
  invoice_id: string | null
  origination_date: string
  due_date: string
  original_minor: number
  outstanding_minor: number
  paid_minor: number
  credited_minor: number
  financed_minor: number
  lender_tenant_id: string | null
  status: ExposureStatus
  restructured: boolean
  write_off_date: string | null
  last_payment_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

export interface KamaiCreditPoliciesRow {
  id: string
  tenant_id: string
  name: string
  version: number
  effective_from: string
  rules: Json
  created_by: string | null
  created_at: string
}

export interface KamaiCreditSnapshotsRow {
  snapshot_date: string
  store_id: string
  tenant_id: string
  outstanding_minor: number
  max_dpd: number
  bucket: DpdBucket
  tier: number | null
  limit_minor: number | null
  status: CreditStatus | null
  eligible: boolean
  ineligibility_reason: string | null
}

export interface KamaiDeliveryOtpsRow {
  order_id: string
  tenant_id: string
  code: string
  expires_at: string
  created_at: string
}

export interface KamaiDeliveryProofsRow {
  order_id: string
  tenant_id: string
  otp_verified_at: string | null
  delivered_lat: number | null
  delivered_lng: number | null
  gps_accuracy_m: number | null
  store_lat: number | null
  store_lng: number | null
  distance_m: number | null
  geofence_radius_m: number | null
  geofence_ok: boolean | null
  override_reason: string | null
  flagged: boolean
  /** storage PATH in the private kamai-pod bucket (<tenant_id>/...); display via createSignedUrl */
  photo_url: string | null
  signature_url: string | null
  receiver_name: string | null
  delivery_status: DeliveryStatus | null
  confirmed_by: string | null
  confirmed_at: string | null
  dispute_window_ends_at: string | null
  disputed_at: string | null
  dispute_reason: string | null
  resolved_at: string | null
  resolution: string | null
  credit_minor: number | null
  created_at: string
}

export interface KamaiDunningEventsRow {
  id: string
  tenant_id: string
  exposure_id: string
  store_id: string
  rule_id: string | null
  offset_days: number
  action: string
  status: 'queued' | 'skipped'
  wa_message_id: string | null
  created_at: string
}

export interface KamaiDunningRulesRow {
  id: string
  tenant_id: string
  offset_days: number
  action: string
  template_name: string | null
  active: boolean
}

export interface KamaiFacilitiesRow {
  id: string
  lender_tenant_id: string
  borrower_tenant_id: string
  technique: FacilityTechnique
  limit_minor: number
  tranche_minor: number | null
  tenor_days: number
  advance_rate_pct: number
  first_loss_pct: number
  pricing: Json
  status: 'draft' | 'active' | 'suspended' | 'closed'
  debtor_of_record: 'store' | 'distributor'
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface KamaiFinancingsRow {
  id: string
  tenant_id: string
  lender_tenant_id: string
  facility_id: string
  order_id: string
  exposure_id: string
  disbursed_minor: number
  disbursed_at: string
  due_date: string
  repaid_minor: number
  status: FinancingStatus
  lender_ref: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface KamaiInvitesRow {
  id: string
  tenant_id: string
  token_hash: string
  role: MembershipRole
  store_id: string | null
  email: string | null
  phone: string | null
  expires_at: string
  used_at: string | null
  used_by: string | null
  created_by: string | null
  created_at: string
}

export interface KamaiInvoiceItemsRow {
  id: string
  tenant_id: string
  invoice_id: string
  product_id: string | null
  line_no: number
  description: string
  hs_code: string | null
  uom: string | null
  qty: number
  unit_price_minor: number
  tax_rate_pct: number
  sale_type: string
  value_excl_st_minor: number
  retail_price_base_minor: number | null
  sales_tax_minor: number
  further_tax_minor: number
  extra_tax_minor: number
  line_total_minor: number
}

export interface KamaiInvoicesRow {
  id: string
  tenant_id: string
  serial_no: number
  display_number: string
  invoice_type: InvoiceType
  invoice_date: string
  order_id: string | null
  store_id: string
  seller_snapshot: Json
  buyer_snapshot: Json
  buyer_ntn_cnic: string | null
  buyer_registration_type: 'Registered' | 'Unregistered'
  total_excl_st_minor: number
  sales_tax_minor: number
  further_tax_minor: number
  extra_tax_minor: number
  discount_minor: number
  total_incl_minor: number
  due_date: string | null
  status: InvoiceStatus
  ref_invoice_id: string | null
  fbr_invoice_number: string | null
  fbr_dated: string | null
  fbr_env: 'sandbox' | 'production' | null
  fbr_status: string | null
  fbr_request: Json | null
  fbr_response: Json | null
  fbr_correction_deadline_at: string | null
  pdf_url: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface KamaiKpiSnapshotsRow {
  snapshot_date: string
  metrics: Json
  created_at: string
}

export interface KamaiLedgerAccountsRow {
  id: string
  tenant_id: string
  code: string
  name: string
  type: LedgerAccountType
  normal_side: LedgerSide
  currency: string
  party_type: string | null
  party_id: string | null
  is_control: boolean
  created_at: string
}

export interface KamaiLedgerEntriesRow {
  id: string
  tenant_id: string
  idempotency_key: string
  status: 'pending' | 'posted'
  effective_at: string
  source_type: string
  source_id: string
  reverses_entry_id: string | null
  memo: string | null
  created_by: string | null
  created_at: string
}

export interface KamaiLedgerLinesRow {
  id: number
  tenant_id: string
  entry_id: string
  account_id: string
  direction: LedgerSide
  amount_minor: number
  currency: string
  party_type: string | null
  party_id: string | null
  memo: string | null
}

export interface KamaiMembershipsRow {
  tenant_id: string
  user_id: string
  role: MembershipRole
  store_id: string | null
  status: MembershipStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface KamaiOrderEventsRow {
  id: number
  tenant_id: string
  order_id: string
  from_state: string | null
  to_state: string
  actor: string | null
  reason: string | null
  meta: Json
  at: string
}

export interface KamaiOrderItemsRow {
  id: string
  tenant_id: string
  order_id: string
  product_id: string
  sku: string
  name: string
  qty: number
  delivered_qty: number
  unit_price_minor: number
  tax_rate_pct: number
  line_total_minor: number
  tax_minor: number
  retail_price_minor: number | null
  is_third_schedule: boolean
  created_at: string
}

export interface KamaiOrdersRow {
  id: string
  tenant_id: string
  store_id: string
  order_no: number
  source: OrderSource
  fulfilment_status: FulfilmentStatus
  finance_status: FinanceStatus
  payment_mode: PaymentMode
  subtotal_minor: number
  tax_minor: number
  total_minor: number
  items_count: number
  rider_user_id: string | null
  credit_decision_id: string | null
  invoice_id: string | null
  client_order_id: string | null
  legacy_order_id: string | null
  cancellation_reason: string | null
  notes: string | null
  credit_approved_at: string | null
  packed_at: string | null
  dispatched_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  rejected_at: string | null
  disputed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface KamaiOsTasksRow {
  id: string
  panel: string
  title: string
  meta: string | null
  owner: string | null
  priority: 'P1' | 'P2' | 'P3' | null
  sort: number
  done: boolean
  done_at: string | null
  note: string | null
  updated_by: string | null
  updated_at: string
}

export interface KamaiPaymentAllocationsRow {
  id: string
  tenant_id: string
  payment_id: string
  exposure_id: string
  amount_minor: number
  reversed_at: string | null
  created_at: string
}

export interface KamaiPaymentsRow {
  id: string
  tenant_id: string
  store_id: string
  amount_minor: number
  channel: PaymentChannel
  external_ref: string | null
  reference_code: string | null
  collected_by: string | null
  collected_at: string
  status: PaymentStatus
  evidence_url: string | null
  notes: string | null
  order_id: string | null
  legacy_payment_id: string | null
  client_key: string | null
  reported_by: string | null
  settled_at: string | null
  order_applied_minor: number
  verified_by: string | null
  verified_at: string | null
  reversed_at: string | null
  reversal_reason: string | null
  created_at: string
}

export interface KamaiPlatformAdminsRow {
  user_id: string
  note: string | null
  created_at: string
}

export interface KamaiPriceListItemsRow {
  id: string
  tenant_id: string
  price_list_id: string
  product_id: string
  price_minor: number
  created_at: string
  updated_at: string
}

export interface KamaiPriceListsRow {
  id: string
  tenant_id: string
  name: string
  tier: PriceTier
  is_default: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export interface KamaiProductCostsRow {
  product_id: string
  tenant_id: string
  cost_price_minor: number
  updated_at: string
}

export interface KamaiProductsRow {
  id: string
  tenant_id: string
  sku: string
  name: string
  name_ur: string | null
  category: string | null
  brand_tenant_id: string | null
  legacy_product_id: string | null
  gtin14: string | null
  gtin_type: number | null
  hs_code: string | null
  fbr_uom: string | null
  tax_rate_pct: number
  sale_type: string
  is_third_schedule: boolean
  retail_price_minor: number | null
  trade_price_minor: number
  image_url: string | null
  pack_size: string | null
  active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  // distributor onboarding (migration 20261110100001)
  listing_status: ListingStatus
  submitted_at: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  review_note: string | null
  original: ProductOriginal | null
  /** only present if the DB migration added a description column */
  description?: string | null
}

export type ListingStatus = 'draft' | 'submitted' | 'changes_requested' | 'approved' | 'rejected'
export type OnboardingStatus = 'pending_review' | 'approved' | 'rejected'
/** Snapshot of the distributor's submission (what they typed before admin edits). */
export interface ProductOriginal {
  name?: string | null
  description?: string | null
  image_url?: string | null
  category?: string | null
  price?: number | null
  [k: string]: Json | undefined
}

/** Admin-only (RLS): platform margin per product. NEVER query from distributor/store surfaces. */
export interface KamaiProductMarginsRow {
  product_id: string
  tenant_id: string
  margin_pct: number
  distributor_price_minor: number | null
  final_price_minor: number | null
  updated_by: string | null
  updated_at: string
}

export type AdminNotificationKind = 'distributor_signup' | 'products_submitted'
export type EmailStatus = 'pending' | 'sent' | 'failed' | 'skipped'
export interface KamaiAdminNotificationsRow {
  id: string
  kind: AdminNotificationKind
  tenant_id: string | null
  payload: { [key: string]: Json | undefined }
  email_status: EmailStatus
  email_attempts: number
  email_error: string | null
  emailed_at: string | null
  read_at: string | null
  created_at: string
}

export interface KamaiReviewQueueRow {
  tenant_id: string
  tenant_name: string
  slug: string
  onboarding_status: OnboardingStatus | string
  contact: { contact_name?: string; mobile?: string; city?: string; email?: string } | null
  submitted_count: number
  draft_count: number
  approved_count: number
  oldest_submitted_at: string | null
  created_at: string
}

export type ReviewAction = 'approve' | 'request_changes' | 'reject'
export interface ReviewPatch { name?: string; description?: string; image_url?: string; category?: string }

export interface KamaiStoreImportsRow {
  id: string
  tenant_id: string
  file_name: string | null
  file_hash: string
  rows_total: number
  rows_created: number
  rows_updated: number
  rows_failed: number
  errors: Json
  status: 'pending' | 'done' | 'failed'
  created_by: string | null
  created_at: string
}

export interface KamaiStoresRow {
  id: string
  tenant_id: string
  legacy_store_id: string | null
  legacy_customer_id: string | null
  name: string
  owner_name: string | null
  mobile: string | null
  address: string | null
  area: string | null
  area_id: string | null
  latitude: number | null
  longitude: number | null
  category: string | null
  tier: PriceTier | null
  price_list_id: string | null
  payment_terms_days: number
  credit_limit_minor: number
  credit_status: CreditStatus
  payment_ref_code: string
  tax_profile: Json
  wa_opt_in_at: string | null
  wa_opt_in_source: string | null
  status: 'active' | 'inactive' | 'blocked'
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface KamaiTenantLinksRow {
  grantor_tenant_id: string
  grantee_tenant_id: string
  kind: TenantLinkKind
  scope: Json
  active: boolean
  created_by: string | null
  created_at: string
}

export interface KamaiTenantsRow {
  id: string
  slug: string
  name: string
  type: TenantType
  status: 'active' | 'suspended' | 'archived'
  settings: Json
  legal_name: string | null
  ntn: string | null
  strn: string | null
  province: string | null
  address: string | null
  invoice_prefix: string | null
  bank_iban: string | null
  raast_alias: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface KamaiWaContactsRow {
  id: string
  tenant_id: string
  wa_id: string
  store_id: string | null
  opted_in_at: string | null
  opt_in_source: string | null
  opt_in_scopes: string[]
  opted_out_at: string | null
  last_inbound_at: string | null
  session: Json
  created_at: string
}

export interface KamaiWaMessagesRow {
  id: string
  tenant_id: string
  contact_id: string | null
  store_id: string | null
  to_wa_id: string | null
  direction: 'in' | 'out'
  wamid: string | null
  template_name: string | null
  category: WaCategory | null
  payload: Json
  status: WaMessageStatus
  pricing_category: string | null
  order_id: string | null
  invoice_id: string | null
  error: string | null
  queued_at: string
  sent_at: string | null
  created_at: string
}

export interface KamaiWaTemplatesRow {
  id: string
  tenant_id: string
  name: string
  language_code: string
  category: 'utility' | 'marketing' | 'authentication'
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'paused'
  components: Json
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// view rows
// ---------------------------------------------------------------------------
export interface KamaiLedgerBalancesRow {
  account_id: string | null
  tenant_id: string | null
  code: string | null
  name: string | null
  type: LedgerAccountType | null
  normal_side: LedgerSide | null
  balance_minor: number | null
}

export interface KamaiVCollectionsRow {
  tenant_id: string | null
  collected_on: string | null
  payments: number | null
  collected_minor: number | null
  cash_minor: number | null
  digital_minor: number | null
}

export interface KamaiVLenderPositionsRow {
  distributor_tenant_id: string | null
  exposure_id: string | null
  order_id: string | null
  invoice_id: string | null
  invoice_number: string | null
  store_id: string | null
  store_name: string | null
  area: string | null
  credit_tier: number | null
  credit_limit_minor: number | null
  origination_date: string | null
  due_date: string | null
  tenor_days: number | null
  original_minor: number | null
  financed_minor: number | null
  outstanding_minor: number | null
  paid_minor: number | null
  credited_minor: number | null
  last_payment_at: string | null
  dpd: number | null
  dpd_bucket: DpdBucket | null
  status: ExposureStatus | null
  restructured: boolean | null
  write_off_date: string | null
  lender_tenant_id: string | null
  delivery_proof_flag: boolean | null
  eligible_flag: boolean | null
  ineligibility_reason: string | null
  created_at: string | null
}

export interface KamaiVParRow {
  tenant_id: string | null
  snapshot_date: string | null
  outstanding_minor: number | null
  par7_minor: number | null
  par30_minor: number | null
  par60_minor: number | null
  par90_minor: number | null
  par7: number | null
  par30: number | null
  par60: number | null
  par90: number | null
}

export interface KamaiVStoreBalancesRow {
  tenant_id: string | null
  store_id: string | null
  balance_minor: number | null
}

export const KAMAI_TABLES = [
  'kamai_audit_log',
  'kamai_bank_lines',
  'kamai_bank_statements',
  'kamai_cash_deposits',
  'kamai_counters',
  'kamai_credit_accounts',
  'kamai_credit_decisions',
  'kamai_credit_events',
  'kamai_credit_exposures',
  'kamai_credit_policies',
  'kamai_credit_snapshots',
  'kamai_delivery_otps',
  'kamai_delivery_proofs',
  'kamai_dunning_events',
  'kamai_dunning_rules',
  'kamai_facilities',
  'kamai_financings',
  'kamai_invites',
  'kamai_invoice_items',
  'kamai_invoices',
  'kamai_kpi_snapshots',
  'kamai_ledger_accounts',
  'kamai_ledger_entries',
  'kamai_ledger_lines',
  'kamai_memberships',
  'kamai_order_events',
  'kamai_order_items',
  'kamai_orders',
  'kamai_os_tasks',
  'kamai_payment_allocations',
  'kamai_payments',
  'kamai_platform_admins',
  'kamai_price_list_items',
  'kamai_price_lists',
  'kamai_product_costs',
  'kamai_products',
  'kamai_product_margins',
  'kamai_admin_notifications',
  'kamai_store_imports',
  'kamai_stores',
  'kamai_tenant_links',
  'kamai_tenants',
  'kamai_wa_contacts',
  'kamai_wa_messages',
  'kamai_wa_templates',
] as const
export type KamaiTable = (typeof KAMAI_TABLES)[number]

export const KAMAI_VIEWS = [
  'kamai_ledger_balances',
  'kamai_v_collections',
  'kamai_v_lender_positions',
  'kamai_v_par',
  'kamai_v_store_balances',
] as const
export type KamaiView = (typeof KAMAI_VIEWS)[number]

export interface KamaiTableMap {
  kamai_audit_log: KamaiAuditLogRow
  kamai_bank_lines: KamaiBankLinesRow
  kamai_bank_statements: KamaiBankStatementsRow
  kamai_cash_deposits: KamaiCashDepositsRow
  kamai_counters: KamaiCountersRow
  kamai_credit_accounts: KamaiCreditAccountsRow
  kamai_credit_decisions: KamaiCreditDecisionsRow
  kamai_credit_events: KamaiCreditEventsRow
  kamai_credit_exposures: KamaiCreditExposuresRow
  kamai_credit_policies: KamaiCreditPoliciesRow
  kamai_credit_snapshots: KamaiCreditSnapshotsRow
  kamai_delivery_otps: KamaiDeliveryOtpsRow
  kamai_delivery_proofs: KamaiDeliveryProofsRow
  kamai_dunning_events: KamaiDunningEventsRow
  kamai_dunning_rules: KamaiDunningRulesRow
  kamai_facilities: KamaiFacilitiesRow
  kamai_financings: KamaiFinancingsRow
  kamai_invites: KamaiInvitesRow
  kamai_invoice_items: KamaiInvoiceItemsRow
  kamai_invoices: KamaiInvoicesRow
  kamai_kpi_snapshots: KamaiKpiSnapshotsRow
  kamai_ledger_accounts: KamaiLedgerAccountsRow
  kamai_ledger_entries: KamaiLedgerEntriesRow
  kamai_ledger_lines: KamaiLedgerLinesRow
  kamai_memberships: KamaiMembershipsRow
  kamai_order_events: KamaiOrderEventsRow
  kamai_order_items: KamaiOrderItemsRow
  kamai_orders: KamaiOrdersRow
  kamai_os_tasks: KamaiOsTasksRow
  kamai_payment_allocations: KamaiPaymentAllocationsRow
  kamai_payments: KamaiPaymentsRow
  kamai_platform_admins: KamaiPlatformAdminsRow
  kamai_price_list_items: KamaiPriceListItemsRow
  kamai_price_lists: KamaiPriceListsRow
  kamai_products: KamaiProductsRow
  kamai_product_margins: KamaiProductMarginsRow
  kamai_admin_notifications: KamaiAdminNotificationsRow
  kamai_store_imports: KamaiStoreImportsRow
  kamai_stores: KamaiStoresRow
  kamai_tenant_links: KamaiTenantLinksRow
  kamai_tenants: KamaiTenantsRow
  kamai_wa_contacts: KamaiWaContactsRow
  kamai_wa_messages: KamaiWaMessagesRow
  kamai_wa_templates: KamaiWaTemplatesRow
}
// ---------------------------------------------------------------------------
// RPC payloads and return shapes (supabase.rpc('<name>', args))
// ---------------------------------------------------------------------------
export interface MyContextMembership {
  tenant_id: string
  role: MembershipRole
  store_id: string | null
  status: MembershipStatus
  tenant: { id: string; slug: string; name: string; type: TenantType }
}
export interface MyContext {
  user_id: string | null
  platform_admin: boolean
  legacy_roles: string[]
  memberships: MyContextMembership[]
}

export interface SubmitOrderItemInput { product_id: string; qty: number }
export interface SubmitOrderInput {
  tenant_id: string
  store_id: string
  items: SubmitOrderItemInput[]
  source?: OrderSource
  payment_mode?: PaymentMode
  client_order_id?: string
  notes?: string
}
export interface SubmitOrderResult {
  order: KamaiOrdersRow
  decision: KamaiCreditDecisionsRow | null
  replayed: boolean
}

export interface ConfirmDeliveryOk {
  ok: true
  delivery_status: DeliveryStatus
  geofence_ok: boolean | null
  distance_m: number | null
  flagged?: boolean
  invoice_id?: string
  exposure_id?: string | null
  ledger_entry_id?: string | null
}
export interface ConfirmDeliveryFail {
  ok: false
  error: OtpError | 'GEOFENCE'
  attempts_left?: number
  distance_m?: number | null
  radius_m?: number
}
export type ConfirmDeliveryResult = ConfirmDeliveryOk | ConfirmDeliveryFail

export interface RecordPaymentInput {
  tenant_id: string
  store_id: string
  amount_minor: number
  channel: PaymentChannel
  external_ref?: string
  reference_code?: string
  collected_at?: string
  evidence_url?: string
  notes?: string
  order_id?: string
  client_key?: string
}
export interface RecordPaymentResult {
  payment_id: string
  allocated_minor: number
  unallocated_minor: number
  allocations: Array<{ exposure_id: string; amount_minor: number; closed: boolean }>
  ledger_entry_id: string
}

export interface KamaiBrandSellthroughRow {
  distributor_tenant_id: string; product_id: string; sku: string; product_name: string; order_id: string; store_id: string
  area: string | null; delivered_qty: number; line_total_minor: number; delivered_at: string
}

export interface ReportPaymentResult {
  payment_id: string
  status: string
  verified: boolean
}

export interface LedgerLineInput {
  account_code: string
  direction: LedgerSide
  amount_minor: number
  party_type?: string
  party_id?: string
  memo?: string
}

export interface BankStatementInput { tenant_id: string; file_hash: string; bank_name?: string; account_ref?: string; period_start?: string; period_end?: string; file_name?: string }
export interface BankLineInput { line_date: string; narration?: string; amount_minor: number; direction?: 'credit' | 'debit'; bank_ref?: string }

export interface KamaiRpc {
  kamai_my_context: { args: Record<string, never>; returns: MyContext }
  kamai_create_tenant: { args: { p_slug: string; p_name: string; p_type: TenantType; p_settings?: Json }; returns: string }
  kamai_add_member: { args: { p_tenant: string; p_user: string; p_role: MembershipRole; p_store_id?: string | null }; returns: KamaiMembershipsRow }
  kamai_submit_order: { args: { p: SubmitOrderInput }; returns: SubmitOrderResult }
  kamai_transition_order: { args: { p_order_id: string; p_to_state: Exclude<FulfilmentStatus, 'delivered' | 'disputed'>; p_reason?: string | null; p_meta?: Json }; returns: KamaiOrdersRow }
  kamai_assign_rider: { args: { p_order_id: string; p_rider_user_id: string }; returns: KamaiOrdersRow }
  kamai_issue_delivery_otp: { args: { p_order_id: string }; returns: { expires_at: string } }
  kamai_confirm_delivery: {
    args: {
      p_order_id: string; p_otp?: string | null; p_lat?: number | null; p_lng?: number | null; p_accuracy_m?: number | null
      p_photo_url?: string | null; p_signature_url?: string | null
      p_items?: Array<{ item_id?: string; product_id?: string; delivered_qty: number }> | null
      p_receiver_name?: string | null; p_override_reason?: string | null
    }
    returns: ConfirmDeliveryResult
  }
  kamai_dispute_delivery: { args: { p_order_id: string; p_reason: string }; returns: KamaiDeliveryProofsRow }
  kamai_resolve_dispute: { args: { p_order_id: string; p_resolution: string; p_credit_minor?: number }; returns: { order_id: string; credit_minor: number; credit_note_id: string | null; unapplied_minor?: number } }
  kamai_convert_order_to_cod: { args: { p_order_id: string }; returns: KamaiCreditDecisionsRow }
  kamai_issue_invoice: { args: { p_order_id: string }; returns: string }
  kamai_credit_decide: { args: { p_order_id: string }; returns: KamaiCreditDecisionsRow }
  kamai_evaluate_store: { args: { p_store_id: string }; returns: { store_id: string; tier: number; status: CreditStatus; limit_minor: number; changed: boolean; target_tier: number; max_dpd_open: number } }
  kamai_store_outstanding: { args: { p_store_id: string }; returns: number }
  kamai_record_payment: { args: { p: RecordPaymentInput }; returns: RecordPaymentResult }
  kamai_report_payment: { args: { p_store_id: string; p_amount_minor: number; p_method: PaymentChannel; p_reference: string; p_order_id?: string | null }; returns: ReportPaymentResult }
  kamai_reverse_payment: { args: { p_payment_id: string; p_reason: string }; returns: { payment_id: string; status: 'rejected'; reversal_entry_id: string | null } }
  kamai_brand_sellthrough: { args: { p_days?: number }; returns: KamaiBrandSellthroughRow[] }
  kamai_set_wa_opt_in: { args: { p_store_id: string; p_opt_in: boolean; p_source?: string }; returns: unknown }
  kamai_import_bank_lines: { args: { p_statement: BankStatementInput; p_lines: BankLineInput[] }; returns: { statement_id: string; inserted: number; duplicate: boolean } }
  kamai_match_bank_lines: { args: { p_statement_id: string }; returns: { statement_id: string; matched_by_reference: number; matched_by_external_ref: number; proposed: number; ambiguous: number } }
  kamai_confirm_bank_match: { args: { p_line_id: string; p_payment_id: string }; returns: { line_id: string; payment_id: string; match_status: 'manual' } }
  kamai_close_cash_day: {
    args: { p_tenant: string; p_rider_user_id: string; p_business_date: string; p_deposited_minor: number; p_method?: CashDepositMethod; p_deposit_ref?: string | null; p_slip_url?: string | null; p_notes?: string | null }
    returns: KamaiCashDepositsRow
  }
  kamai_post_entry: { args: { p_tenant: string; p_key: string; p_source_type: string; p_source_id: string; p_effective_at: string | null; p_memo: string | null; p_lines: LedgerLineInput[] }; returns: string }
  kamai_reverse_entry: { args: { p_entry_id: string; p_memo?: string | null }; returns: string }
  kamai_finance_order: { args: { p_order_id: string; p_facility_id: string }; returns: KamaiFinancingsRow }
  kamai_settle_financing: { args: { p_financing_id: string; p_amount_minor: number }; returns: KamaiFinancingsRow }
  kamai_os_kpis: { args: Record<string, never>; returns: OsKpis }
  kamai_run_daily: { args: Record<string, never>; returns: RunDailyResult }
  kamai_import_legacy: { args: { p_tenant_id: string }; returns: { tenant_id: string; stores_created: number; products_created: number; credit_accounts_created: number } }
  kamai_distance_m: { args: { lat1: number; lon1: number; lat2: number; lon2: number }; returns: number }
  kamai_line_tax: { args: { p_qty: number; p_unit_minor: number; p_retail_minor: number | null; p_rate: number; p_third: boolean }; returns: number }
  kamai_dpd_bucket: { args: { p_dpd: number }; returns: DpdBucket }
  kamai_gtin_check_digit_ok: { args: { p_gtin14: string }; returns: boolean }
  kamai_submit_products: { args: { p_product_ids: string[] }; returns: { submitted: number; notification_id: string | null } }
  kamai_review_product: {
    args: { p_product_id: string; p_action: ReviewAction; p_margin_pct?: number | null; p_patch?: ReviewPatch; p_note?: string | null }
    returns: Json
  }
  kamai_review_products_bulk: {
    args: { p_product_ids: string[]; p_action: ReviewAction; p_margin_pct?: number | null; p_note?: string | null }
    returns: { done: number; failed: number }
  }
  kamai_review_distributor: { args: { p_tenant_id: string; p_action: 'approve' | 'reject'; p_note?: string | null }; returns: Json }
  kamai_review_queue: { args: Record<string, never>; returns: KamaiReviewQueueRow[] }
  kamai_mark_notifications_read: { args: { p_ids: string[] }; returns: number }
}
export type KamaiRpcName = keyof KamaiRpc

export const KAMAI_RPCS = [
  'kamai_my_context', 'kamai_create_tenant', 'kamai_add_member', 'kamai_submit_order', 'kamai_transition_order',
  'kamai_assign_rider', 'kamai_issue_delivery_otp', 'kamai_confirm_delivery', 'kamai_dispute_delivery',
  'kamai_resolve_dispute', 'kamai_convert_order_to_cod', 'kamai_issue_invoice', 'kamai_credit_decide',
  'kamai_evaluate_store', 'kamai_store_outstanding', 'kamai_record_payment', 'kamai_report_payment', 'kamai_reverse_payment', 'kamai_brand_sellthrough', 'kamai_set_wa_opt_in', 'kamai_import_bank_lines',
  'kamai_match_bank_lines', 'kamai_confirm_bank_match', 'kamai_close_cash_day', 'kamai_post_entry',
  'kamai_reverse_entry', 'kamai_finance_order', 'kamai_settle_financing', 'kamai_os_kpis', 'kamai_run_daily',
  'kamai_import_legacy', 'kamai_distance_m', 'kamai_line_tax', 'kamai_dpd_bucket', 'kamai_gtin_check_digit_ok',
  'kamai_submit_products', 'kamai_review_product', 'kamai_review_products_bulk', 'kamai_review_distributor', 'kamai_review_queue', 'kamai_mark_notifications_read',
] as const

export interface OsKpis {
  // legacy (public.invoices / customers / payments / orders / stores / user_roles); money in rupees (numeric)
  invoices: number; voided: number; invoiced_total: number; unpaid_total: number; open_bal_total: number
  ar_60plus: number; ar_60plus_count: number; collected_yesterday: number
  orders_all: number; live_orders: number; live_value: number; cancelled: number; rejected: number
  orders_7d: number; value_7d: number; heroes_active_7d: number; stuck_orders: number
  stores: number; stores_ordered: number; heroes_registered: number; heroes_active: number
  // kamai
  kamai_tenants: number; kamai_stores: number
  kamai_orders_by_state: Partial<Record<FulfilmentStatus, number>>
  kamai_outstanding_minor: number; kamai_par30: number | null; kamai_wa_queued: number
  generated_at: string
}
export interface RunDailyResult {
  date: string; stores_evaluated: number; snapshots: number; dunning_events: number
  wa_queued: number; tenants_paused: number; tenants_unpaused: number
  errors?: number; error_samples?: string[]
}

// Default credit policy rules (kamai_credit_policies.rules)
export interface CreditPolicyRules {
  tiers: Record<'0' | '1' | '2' | '3', { limit_minor: number; tenor_days: number }>
  tier_requirements?: Record<'1' | '2' | '3', { orders: number; days: number; on_time?: number; max_dpd_180?: number; closed?: number }>
  grace_days: number
  pause_dpd: number
  freeze_dpd: number
  writeoff_dpd: number
  max_store_exposure_pct_of_tenant: number
  tenant_exposure_cap_minor: number | null
  par30_pause_pct: number
}
