import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cx } from './cx'

interface FieldChrome {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** wrap in a block with label/hint/error (default true when label given) */
  className?: string
}

function FieldWrap({ id, label, hint, error, className, children, required }: FieldChrome & { id: string; children: ReactNode; required?: boolean }) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={id} className="text-xs font-bold uppercase tracking-[1px] text-k-muted">
          {label}
          {required ? <span className="text-k-red"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <div className="text-xs font-semibold text-k-red" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="text-xs text-k-light">{hint}</div>
      ) : null}
    </div>
  )
}

const CONTROL =
  'w-full rounded-lg border bg-k-surface px-3 text-sm text-k-text placeholder:text-k-light focus:outline-none focus:ring-2 focus:ring-k-green/30 focus:border-k-green disabled:bg-k-surface2 disabled:text-k-muted'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'>, FieldChrome {
  size?: 'md' | 'lg'
  /** element rendered inside at the left (e.g. "+92" or an icon) */
  prefix?: ReactNode
  suffix?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, size = 'md', prefix, suffix, id: idProp, required, ...rest },
  ref,
) {
  const auto = useId()
  const id = idProp ?? auto
  const h = size === 'lg' ? 'h-12 text-base' : 'h-10'
  const control = (
    <div className="relative flex items-center">
      {prefix ? <span className="pointer-events-none absolute left-3 text-sm text-k-muted">{prefix}</span> : null}
      <input
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cx(CONTROL, h, error ? 'border-k-red' : 'border-k-border', prefix && 'pl-12', suffix && 'pr-10')}
        {...rest}
      />
      {suffix ? <span className="absolute right-3 text-sm text-k-muted">{suffix}</span> : null}
    </div>
  )
  return (
    <FieldWrap id={id} label={label} hint={hint} error={error} className={className} required={required}>
      {control}
    </FieldWrap>
  )
})

export interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>, FieldChrome {
  options?: SelectOption[]
  placeholder?: string
  size?: 'md' | 'lg'
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className, options, placeholder, size = 'md', id: idProp, required, children, ...rest },
  ref,
) {
  const auto = useId()
  const id = idProp ?? auto
  return (
    <FieldWrap id={id} label={label} hint={hint} error={error} className={className} required={required}>
      <select
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cx(CONTROL, size === 'lg' ? 'h-12 text-base' : 'h-10', 'appearance-none pr-9', error ? 'border-k-red' : 'border-k-border')}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%235c6660' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 10px center',
        }}
        {...rest}
      >
        {placeholder !== undefined ? (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        ) : null}
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
          : children}
      </select>
    </FieldWrap>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldChrome {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id: idProp, required, rows = 3, ...rest },
  ref,
) {
  const auto = useId()
  const id = idProp ?? auto
  return (
    <FieldWrap id={id} label={label} hint={hint} error={error} className={className} required={required}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cx(CONTROL, 'py-2', error ? 'border-k-red' : 'border-k-border')}
        {...rest}
      />
    </FieldWrap>
  )
})

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode
  description?: ReactNode
  error?: ReactNode
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, description, error, className, id: idProp, ...rest }, ref) {
  const auto = useId()
  const id = idProp ?? auto
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm text-k-text">
        <input ref={ref} id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-k-green" {...rest} />
        <span className="flex flex-col">
          {label ? <span className="font-medium">{label}</span> : null}
          {description ? <span className="text-xs text-k-muted">{description}</span> : null}
        </span>
      </label>
      {error ? (
        <div className="text-xs font-semibold text-k-red" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  )
})
