import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, MessageSquare } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { KamaiOsTasksRow } from '../../lib/db-types'
import { Badge, Button, Card, Textarea, cx, useToast } from '../../ui'
import { fmtDate } from '../../lib/format'
import type { TaskDef } from '../content/types'
import { PrioTag } from './content-ui'
import { errMsg } from '../lib/tenants'

type TaskState = Pick<KamaiOsTasksRow, 'id' | 'done' | 'done_at' | 'note'>

const KEY = ['os', 'tasks'] as const

function useTaskRows() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Record<string, TaskState>> => {
      const { data, error } = await supabase.from('kamai_os_tasks').select('id, done, done_at, note')
      if (error) throw new Error(error.message)
      return Object.fromEntries(((data ?? []) as TaskState[]).map((r) => [r.id, r]))
    },
    staleTime: 30_000,
    retry: false,
  })
}

/**
 * Task checklist backed by kamai_os_tasks. Static definitions provide the text; the DB provides
 * done / done_at / note. Toggling is optimistic and rolls back on error. If the table is not
 * available the list still renders and the ticks are kept locally only.
 */
export function TaskList({ defs, replace }: { defs: TaskDef[]; replace?: Record<string, string> }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { user } = useAuth()
  const rows = useTaskRows()
  const [openNote, setOpenNote] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [local, setLocal] = useState<Record<string, boolean>>({})
  const offline = !!rows.error

  const save = useMutation({
    mutationFn: async ({ def, patch }: { def: TaskDef; patch: Partial<Pick<KamaiOsTasksRow, 'done' | 'done_at' | 'note'>> }) => {
      const full = { ...patch, updated_by: user?.id ?? null, updated_at: new Date().toISOString() }
      const upd = await supabase.from('kamai_os_tasks').update(full).eq('id', def.id).select('id')
      if (upd.error) throw new Error(upd.error.message)
      if (!upd.data || upd.data.length === 0) {
        const ins = await supabase.from('kamai_os_tasks').insert({
          id: def.id, panel: def.panel, title: def.title, meta: def.meta, owner: def.owner, priority: def.priority, sort: def.sort,
          done: false, ...full,
        })
        if (ins.error) throw new Error(ins.error.message)
      }
    },
    onMutate: async ({ def, patch }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = qc.getQueryData<Record<string, TaskState>>(KEY)
      qc.setQueryData<Record<string, TaskState>>(KEY, (cur) => {
        const base = cur?.[def.id] ?? { id: def.id, done: false, done_at: null, note: null }
        return { ...(cur ?? {}), [def.id]: { ...base, ...patch } }
      })
      return { prev }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev)
      toast.error(errMsg(e), { title: 'Could not save task' })
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  })

  const fill = (s: string) => Object.entries(replace ?? {}).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), s)

  const toggle = (def: TaskDef, done: boolean) => {
    if (offline) {
      setLocal((l) => ({ ...l, [def.id]: !done }))
      return
    }
    save.mutate({ def, patch: { done: !done, done_at: !done ? new Date().toISOString() : null } })
  }

  const saveNote = (def: TaskDef) => {
    save.mutate({ def, patch: { note: draft.trim() || null } })
    setOpenNote(null)
  }

  return (
    <Card padding="sm">
      {offline ? (
        <div className="mb-2 rounded-lg bg-[#fff8e6] px-3 py-2 text-xs text-[#5c4300]">
          Task storage is unavailable ({errMsg(rows.error)}). Ticks below are local to this page and are not saved.
        </div>
      ) : null}
      <ul className="divide-y divide-k-border">
        {defs.map((d) => {
          const s = rows.data?.[d.id]
          const done = offline ? !!local[d.id] : !!s?.done
          const note = s?.note ?? ''
          return (
            <li key={d.id} className="flex items-start gap-3 px-2 py-3.5">
              <button
                role="checkbox"
                aria-checked={done}
                aria-label={done ? 'Mark as not done' : 'Mark as done'}
                onClick={() => toggle(d, done)}
                className={cx(
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                  done ? 'border-k-green bg-k-green text-white' : 'border-k-border bg-k-surface text-transparent hover:border-k-green',
                )}
              >
                <Check size={14} strokeWidth={3} />
              </button>
              <div className="min-w-0 flex-1">
                <div className={cx('text-sm font-semibold text-k-dark', done && 'text-k-light line-through')}>{d.title}</div>
                <div className="mt-0.5 text-[13px] text-k-muted">{fill(d.meta)}</div>
                {d.owner ? <div className="mt-1 text-xs font-semibold text-k-green">Owner: {d.owner}</div> : null}
                {note && openNote !== d.id ? <div className="mt-1.5 rounded-lg bg-k-surface2 px-2.5 py-1.5 text-xs text-k-text">{note}</div> : null}
                {done && s?.done_at ? <div className="mt-1 text-[11px] text-k-light">Done {fmtDate(s.done_at)}</div> : null}
                {openNote === d.id ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="Add a note" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveNote(d)}>Save note</Button>
                      <Button size="sm" variant="ghost" onClick={() => setOpenNote(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {d.priority ? <PrioTag p={d.priority} /> : null}
                {!offline ? (
                  <button
                    onClick={() => {
                      setDraft(note)
                      setOpenNote(openNote === d.id ? null : d.id)
                    }}
                    aria-label="Edit note"
                    className={cx('rounded-md p-1 hover:bg-k-surface2', note ? 'text-k-green' : 'text-k-light')}
                  >
                    <MessageSquare size={16} />
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      {rows.isLoading ? <div className="px-2 pb-1 pt-2"><Badge tone="muted">Loading saved state…</Badge></div> : null}
    </Card>
  )
}
