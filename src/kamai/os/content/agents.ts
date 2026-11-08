import type { Intro, Tbl } from './types'

export const agentsIntro: Intro = {
  title: 'AI Agent Department',
  body: 'Each agent has a defined role, runs specific automated tasks, and reports to you. These are prompts and automations you activate via Claude, Claude Code, or Zapier. **No code needed to start. Each one is a workflow you trigger.**',
}

export interface AgentDef {
  icon: string
  name: string
  role: string
  status: string
  tasks: string[]
}

export const agents: AgentDef[] = [
  { icon: '📦', name: 'Procurement Agent', role: 'Sourcing, supplier rates, margin math', status: 'Active on demand', tasks: [
    'Weekly: compare APT buy prices against 3 alternative suppliers for top 10 SKUs',
    'On request: calculate landed cost + margin for any new product',
    'On request: draft supplier contact email for new brand partnership',
    'Monthly: flag SKUs where margin has dropped below 15%',
  ] },
  { icon: '🏪', name: 'Vendor Onboarding Agent', role: 'Brand partnerships, agreements, onboarding', status: 'Active on demand', tasks: [
    'Draft brand partnership pitch for any new importer or Shopify brand',
    'Generate distribution agreement template (margin, territory, credit terms)',
    'Build brand profile card for each new product line added',
    'Track vendor onboarding pipeline and follow-up schedule',
  ] },
  { icon: '🦸', name: 'Hero Management Agent', role: 'Recruitment, onboarding, payouts, performance', status: 'Active on demand', tasks: [
    'Weekly: generate performance report per Hero (stores visited, orders, commissions)',
    'Draft Roman Urdu onboarding messages and WhatsApp scripts',
    'Flag Heroes with zero orders in 7 days — draft re-engagement message',
    'Calculate commission payouts for the 10-day payout cycle',
  ] },
  { icon: '💰', name: 'Finance Agent', role: 'AR, AP, cash flow, P&L tracking', status: 'Active on demand', tasks: [
    'Weekly: AR aging report — flag invoices overdue by 15+ days',
    'Draft collection reminder messages by store tier (good, slow, bad payer)',
    'Monthly: P&L summary by product category',
    'On request: cash flow forecast for next 30 and 60 days',
  ] },
  { icon: '📣', name: 'Marketing Agent', role: 'Content, recruitment ads, brand comms', status: 'Active on demand', tasks: [
    'Weekly: 3 social posts for Kamai Hero recruitment (Facebook, OLX, WhatsApp)',
    'Monthly: brand story content for Kamai distribution partners',
    'On request: write ad copy for a specific product category push',
    'Maintain Hero testimonial bank — draft proof-of-payout content',
  ] },
  { icon: '🗺️', name: 'Store Expansion Agent', role: 'Target store research, outreach scripts, coverage maps', status: 'Active on demand', tasks: [
    'Build petrol station database for any city (name, location, owner, estimated footfall)',
    'Draft store visit script for Hero first approach',
    'Weekly: flag stores with no reorder in 21 days',
    'On request: map coverage gaps in any area',
  ] },
  { icon: '🤝', name: 'Investor Relations Agent', role: 'Ali follow-up, reporting, deck updates', status: 'Active on demand', tasks: [
    'Weekly: draft Ali update message with current traction numbers',
    'On request: update investor deck with new data',
    'Track all Ali deliverables with follow-up reminders',
    'Prepare one-pager for any new investor conversation',
  ] },
  { icon: '⚙️', name: 'Operations Agent', role: 'Delivery scheduling, order status, issue escalation', status: 'Active on demand', tasks: [
    'Daily: check Rider Orders for pending/stuck orders and flag to Zohaib',
    'Draft delivery SOP for new city or area launch',
    'Weekly: returns and cancellation analysis — identify root cause',
    'On request: draft WhatsApp message to store for any delivery issue',
  ] },
  { icon: '👥', name: 'HR Agent', role: 'Hiring, contracts, team tracking', status: 'Active on demand', tasks: [
    'Draft JD for any new hire (area manager, coordinator, driver)',
    'Generate interview guide and scoring rubric for any role',
    'Maintain team tracker — roles, start dates, responsibilities',
    'Draft offer letter template for each role type',
  ] },
]

export const activateTable: Tbl = {
  head: ['Agent', 'How to trigger', 'Output'],
  rows: [
    ['Procurement', 'Paste supplier price list + ask margin math', 'SKU-level margin table'],
    ['Vendor Onboarding', 'Give brand name and product — ask for pitch', 'Email + agreement draft'],
    ['Hero Management', 'Share weekly order data — ask for performance report', 'Hero scorecard + actions'],
    ['Finance', 'Share invoices CSV or ERP screenshot — ask AR report', 'Aging table + chase messages'],
    ['Marketing', 'Give week / city / product — ask for posts', '3 ready-to-post creatives'],
    ['Store Expansion', 'Give city or area name — ask for petrol station list', 'Mapped store database'],
    ['Investor Relations', 'Ask for Ali update with latest numbers', 'WhatsApp + email draft'],
    ['Operations', 'Share order status data — ask for stuck order list', 'Escalation list + actions'],
    ['HR', 'Give role name — ask for JD and interview guide', 'Full hiring packet'],
  ],
}
