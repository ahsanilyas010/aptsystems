import type { BadgeTone } from '../../ui'

export type Prio = 'P1' | 'P2' | 'P3'

/** A table cell in static content: plain text or a small styled token. */
export type Cell =
  | string
  | { strong: string }
  | { badge: string; tone: BadgeTone }
  | { prio: Prio }
  | { link: string; href: string }

export interface Tbl {
  head: string[]
  rows: Cell[][]
}

export interface TimelineItem {
  month: string
  title: string
  desc: string
  state?: 'pending' | 'future'
}

export interface TaskDef {
  id: string
  panel: 'command' | 'gaps'
  title: string
  /** may contain the {ar} placeholder, replaced with the live AR figure */
  meta: string
  owner: string | null
  priority: Prio | null
  sort: number
}

export interface Intro {
  title: string
  /** paragraphs; use **bold** for emphasis */
  body: string
}

export const b = (strong: string): Cell => ({ strong })
export const badge = (text: string, tone: BadgeTone): Cell => ({ badge: text, tone })
export const prio = (p: Prio): Cell => ({ prio: p })
export const link = (text: string, href: string): Cell => ({ link: text, href })
