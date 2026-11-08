import { Download, Share } from 'lucide-react'
import { Button, Card } from '../../ui'
import { useLang } from '../../lib/i18n'
import { useInstall } from './pwa'
import './strings'

/** Add-to-home-screen prompt, shown after the first order (Android beforeinstallprompt, iOS hint). */
export function InstallBanner({ hasOrders }: { hasOrders: boolean }) {
  const { t } = useLang()
  const inst = useInstall(hasOrders)
  if (!inst.show) return null
  return (
    <Card tone="green" padding="sm" className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-bold">
        {inst.canPrompt ? <Download size={18} /> : <Share size={18} />}
        {t('st_install')}
      </div>
      {!inst.canPrompt && inst.ios ? <p className="text-[13px] text-[#d9f2e3]">{t('st_install_ios')}</p> : null}
      <div className="flex gap-2">
        {inst.canPrompt ? (
          <Button variant="secondary" onClick={() => void inst.install()}>
            {t('st_install_btn')}
          </Button>
        ) : null}
        <Button variant="ghost" className="text-white hover:bg-white/10" onClick={inst.dismiss}>
          {t('st_dismiss')}
        </Button>
      </div>
    </Card>
  )
}
