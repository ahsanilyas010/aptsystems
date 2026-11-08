import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** icon rendered before children */
  icon?: ReactNode
  /** stretch to container width */
  block?: boolean
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-k-green text-white border border-k-green hover:bg-[#1a7a42] disabled:bg-k-green/50 disabled:border-transparent',
  secondary: 'bg-k-surface text-k-dark border border-k-border hover:bg-k-surface2 disabled:text-k-light',
  ghost: 'bg-transparent text-k-dark border border-transparent hover:bg-k-surface2 disabled:text-k-light',
  danger: 'bg-k-red text-white border border-k-red hover:bg-[#a93226] disabled:bg-k-red/50 disabled:border-transparent',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-k-green',
        VARIANT[variant],
        SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 18 : 14} className="shrink-0" /> : icon ? <span className="inline-flex shrink-0 items-center">{icon}</span> : null}
      {children}
    </button>
  )
})
