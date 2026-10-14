import { Tex } from '@/lib/tex'
import { cn } from '@/lib/utils'
import type { Pin } from '@/types'

/** Содержимое карточки закрепа: заголовок, формула, пояснение. */
export function PinBody({ pin, size = 'md', hideTitle = false }: { pin: Pin; size?: 'sm' | 'md'; hideTitle?: boolean }) {
  return (
    <>
      {!hideTitle && <div className={cn('font-semibold', size === 'sm' ? 'text-[13px]' : 'text-[14px]')}>{pin.title}</div>}
      {pin.tex && (
        <div className={cn('thin-scrollbar overflow-x-auto py-2', size === 'sm' ? 'text-[14px]' : 'text-[16px]')}>
          <Tex tex={pin.tex} block />
        </div>
      )}
      {pin.text && <p className="text-[13px] text-muted-foreground">{pin.text}</p>}
    </>
  )
}
