import { Outlet } from 'react-router'
import { LANGS, useLang } from '../lib/i18n'
import { cx } from '../ui'

export function AuthLayout() {
  const { lang, setLang } = useLang()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-k-bg p-4">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center">
          <div className="text-3xl font-extrabold tracking-tight text-k-dark">Kamai</div>
          <div className="text-[11px] font-bold uppercase tracking-[2px] text-k-muted">Distribution OS</div>
        </div>
        <Outlet />
        <div className="mt-5 flex justify-center gap-1" role="group" aria-label="Language">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLang(l.code)}
              aria-pressed={lang === l.code}
              className={cx(
                'rounded-full border px-3 py-1 text-xs font-semibold',
                lang === l.code ? 'border-k-green bg-k-green text-white' : 'border-k-border bg-k-surface text-k-muted',
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
