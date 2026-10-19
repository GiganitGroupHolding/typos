import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/** Кнопки окна в десктоп-версии: системная шапка выключена (decorations: false), рисуем свои. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    const win = getCurrentWindow()
    let off: (() => void) | undefined
    let alive = true
    const sync = () => void win.isMaximized().then((v) => alive && setMaximized(v))
    sync()
    void win.onResized(sync).then((fn) => {
      if (alive) off = fn
      else fn()
    })
    return () => {
      alive = false
      off?.()
    }
  }, [])

  if (!isTauri()) return null
  const win = getCurrentWindow()
  const btn =
    'flex h-8 w-10 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-(--dur-fast) hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4'

  return (
    <div className="ml-1 flex items-center gap-0.5">
      <button type="button" aria-label="Свернуть" title="Свернуть" onClick={() => void win.minimize()} className={btn}>
        <Minus />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Восстановить' : 'Развернуть'}
        title={maximized ? 'Восстановить' : 'Развернуть'}
        onClick={() => void win.toggleMaximize()}
        className={cn(btn, '[&_svg]:size-3.5')}
      >
        {maximized ? <Copy className="-scale-x-100" /> : <Square />}
      </button>
      <button
        type="button"
        aria-label="Закрыть"
        title="Закрыть"
        onClick={() => void win.close()}
        className={cn(btn, 'hover:bg-[#e81123] hover:text-white')}
      >
        <X />
      </button>
    </div>
  )
}
