import { KeyRound, WifiOff } from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "react-router"
import { Button } from "@/components/ui/Button"
import { plural } from "@/lib/format"
import { useConnection } from "@/storage/connection"
import { useSync } from "@/storage/sync"
import { useVault } from "@/vault/store"

function useSecondsUntil(at?: number) {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!at) return
    const update = () => setLeft(Math.max(0, Math.ceil((at - Date.now()) / 1000)))
    const first = setTimeout(update, 0)
    const t = setInterval(update, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [at])
  return at ? left : 0
}

export function ConnectionBanner() {
  const status = useConnection((s) => s.status)
  const retryAt = useConnection((s) => s.retryAt)
  const retry = useConnection((s) => s.retry)
  const label = useVault((s) => s.adapter?.label)
  const pending = useSync((s) => s.pending)
  const seconds = useSecondsUntil(status === "offline" ? retryAt : undefined)
  if (status !== "offline" && status !== "revoked") return null

  return (
    <div
      role="status"
      className="glass absolute top-14 left-1/2 z-30 flex w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-destructive/30 px-4 py-2.5 shadow-float"
    >
      {status === "offline" ? (
        <WifiOff className="size-4 shrink-0 text-destructive" />
      ) : (
        <KeyRound className="size-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="font-semibold">
          {status === "offline" ? `Нет связи с сервером «${label}»` : `Сервер «${label}» не принимает ключ этого устройства`}
        </p>
        <p className="text-muted-foreground">
          {status === "offline"
            ? `Правки сохраняются на этом устройстве${pending ? ` (ждут отправки: ${plural(pending, ["файл", "файла", "файлов"])})` : ""} и уйдут на сервер, когда связь вернётся.${seconds ? ` Повтор через ${seconds} с.` : " Подключаюсь…"}`
            : "Правки сохраняются на этом устройстве, но не отправятся: устройство отключили или выдали ему новый ключ. Нужна свежая ссылка."}
        </p>
      </div>
      {status === "offline" ? (
        <Button size="sm" variant="outline" onClick={retry}>
          Повторить
        </Button>
      ) : (
        <Button size="sm" variant="outline" asChild>
          <Link to="/welcome">Подключить</Link>
        </Button>
      )}
    </div>
  )
}
