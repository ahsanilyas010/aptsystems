import { useCallback, useEffect, useState } from 'react'

export type Lang = 'en' | 'ru' | 'ur'
export const LANGS: Array<{ code: Lang; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Roman Urdu' },
  { code: 'ur', label: 'اردو' },
]
export const LANG_STORAGE_KEY = 'kamai-lang'

// Tiny dictionary. Keys are stable identifiers; feature builders may extend
// with `extendDictionary({...})` at module load.
const dict: Record<string, Partial<Record<Lang, string>>> = {
  home: { en: 'Home', ru: 'Home', ur: 'ہوم' },
  catalog: { en: 'Catalog', ru: 'Catalog', ur: 'کیٹلاگ' },
  cart: { en: 'Cart', ru: 'Cart', ur: 'ٹوکری' },
  orders: { en: 'Orders', ru: 'Orders', ur: 'آرڈرز' },
  order: { en: 'Order', ru: 'Order', ur: 'آرڈر' },
  pay: { en: 'Pay', ru: 'Payment karein', ur: 'ادائیگی' },
  account: { en: 'Account', ru: 'Account', ur: 'اکاؤنٹ' },
  reorder: { en: 'Reorder', ru: 'Dobara order karein', ur: 'دوبارہ آرڈر' },
  add_to_cart: { en: 'Add to cart', ru: 'Cart mein dalein', ur: 'ٹوکری میں ڈالیں' },
  place_order: { en: 'Place order', ru: 'Order karein', ur: 'آرڈر کریں' },
  total: { en: 'Total', ru: 'Total', ur: 'کل' },
  subtotal: { en: 'Subtotal', ru: 'Subtotal', ur: 'ذیلی کل' },
  tax: { en: 'Tax', ru: 'Tax', ur: 'ٹیکس' },
  outstanding: { en: 'Outstanding', ru: 'Baqaya', ur: 'بقایا' },
  credit_limit: { en: 'Credit limit', ru: 'Credit limit', ur: 'کریڈٹ کی حد' },
  available_credit: { en: 'Available credit', ru: 'Dastiyab credit', ur: 'دستیاب کریڈٹ' },
  due_date: { en: 'Due date', ru: 'Aakhri tareekh', ur: 'آخری تاریخ' },
  overdue: { en: 'Overdue', ru: 'Der ho gayi', ur: 'تاخیر شدہ' },
  paid: { en: 'Paid', ru: 'Ada shuda', ur: 'ادا شدہ' },
  delivered: { en: 'Delivered', ru: 'Deliver ho gaya', ur: 'پہنچا دیا گیا' },
  dispatched: { en: 'Dispatched', ru: 'Rawana', ur: 'روانہ' },
  booked: { en: 'Booked', ru: 'Book ho gaya', ur: 'بک ہو گیا' },
  cancelled: { en: 'Cancelled', ru: 'Cancel', ur: 'منسوخ' },
  disputed: { en: 'Disputed', ru: 'Shikayat', ur: 'تنازعہ' },
  confirm: { en: 'Confirm', ru: 'Tasdeeq karein', ur: 'تصدیق کریں' },
  cancel: { en: 'Cancel', ru: 'Cancel karein', ur: 'منسوخ کریں' },
  save: { en: 'Save', ru: 'Save karein', ur: 'محفوظ کریں' },
  back: { en: 'Back', ru: 'Wapas', ur: 'واپس' },
  next: { en: 'Next', ru: 'Agla', ur: 'اگلا' },
  search: { en: 'Search', ru: 'Talash', ur: 'تلاش' },
  login: { en: 'Log in', ru: 'Login karein', ur: 'لاگ ان' },
  logout: { en: 'Log out', ru: 'Logout', ur: 'لاگ آؤٹ' },
  mobile: { en: 'Mobile number', ru: 'Mobile number', ur: 'موبائل نمبر' },
  pin: { en: 'PIN', ru: 'PIN', ur: 'پن' },
  email: { en: 'Email', ru: 'Email', ur: 'ای میل' },
  password: { en: 'Password', ru: 'Password', ur: 'پاس ورڈ' },
  otp: { en: 'Delivery OTP', ru: 'Delivery OTP', ur: 'ڈیلیوری او ٹی پی' },
  qty: { en: 'Qty', ru: 'Miqdar', ur: 'مقدار' },
  price: { en: 'Price', ru: 'Qeemat', ur: 'قیمت' },
  loading: { en: 'Loading…', ru: 'Load ho raha hai…', ur: 'لوڈ ہو رہا ہے…' },
  coming_soon: { en: 'Coming soon', ru: 'Jald aa raha hai', ur: 'جلد آ رہا ہے' },
  no_data: { en: 'Nothing here yet', ru: 'Abhi kuch nahi', ur: 'ابھی کچھ نہیں' },
  retry: { en: 'Retry', ru: 'Dobara koshish', ur: 'دوبارہ کوشش' },
  language: { en: 'Language', ru: 'Zabaan', ur: 'زبان' },
}

export function extendDictionary(entries: Record<string, Partial<Record<Lang, string>>>): void {
  for (const [k, v] of Object.entries(entries)) dict[k] = { ...(dict[k] ?? {}), ...v }
}

export function readLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY)
    if (v === 'en' || v === 'ru' || v === 'ur') return v
  } catch {
    /* storage unavailable */
  }
  return 'en'
}

export function t(key: string, lang: Lang = readLang(), vars?: Record<string, string | number>): string {
  const entry = dict[key]
  let s = entry?.[lang] ?? entry?.en ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  return s
}

export function isRtl(lang: Lang): boolean {
  return lang === 'ur'
}

const listeners = new Set<(l: Lang) => void>()

export function setLangGlobal(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn(lang))
}

/** { lang, setLang, t, dir } persisted in localStorage 'kamai-lang'. */
export function useLang(): { lang: Lang; setLang: (l: Lang) => void; t: (key: string, vars?: Record<string, string | number>) => string; dir: 'ltr' | 'rtl' } {
  const [lang, setLangState] = useState<Lang>(() => readLang())
  useEffect(() => {
    listeners.add(setLangState)
    return () => {
      listeners.delete(setLangState)
    }
  }, [])
  const setLang = useCallback((l: Lang) => setLangGlobal(l), [])
  const tt = useCallback((key: string, vars?: Record<string, string | number>) => t(key, lang, vars), [lang])
  return { lang, setLang, t: tt, dir: isRtl(lang) ? 'rtl' : 'ltr' }
}
