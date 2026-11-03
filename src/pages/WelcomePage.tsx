import { isTauri } from "@tauri-apps/api/core"
import { ArrowLeft, FolderDown, FolderOpen, Loader2, MonitorSmartphone, Server, TriangleAlert } from "lucide-react"
import { motion } from "motion/react"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import { useAccentSync } from "@/app/accent"
import { Nebula } from "@/app/layout/Nebula"
import { Button } from "@/components/ui/Button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog"
import { Input } from "@/components/ui/Input"
import { LiquidButton } from "@/components/ui/LiquidButton"
import { errorText } from "@/lib/errors"
import { plural } from "@/lib/format"
import { listItem, listParent } from "@/lib/motion"
import { createBrowserAdapter } from "@/storage/browserAdapter"
import { fsaSupported } from "@/storage/fsaAdapter"
import { blockedAsMixedContent, MIXED_CONTENT_HINT, parseRemoteLink } from "@/storage/remoteLink"
import { useSync } from "@/storage/sync"
import { SyncedAdapter } from "@/storage/syncedAdapter"
import { storageLabel } from "@/storage/VaultAdapter"
import { countNotes } from "@/vault/repo"
import { useVault } from "@/vault/store"

export function WelcomePage() {
  useAccentSync(undefined)
  const navigate = useNavigate()
  const adapter = useVault((s) => s.adapter)
  const status = useVault((s) => s.status)
  const init = useVault((s) => s.init)
  const connectFolder = useVault((s) => s.connectFolder)
  const connectRemote = useVault((s) => s.connectRemote)
  const switchToBrowser = useVault((s) => s.switchToBrowser)
  const copyToFolder = useVault((s) => s.copyToFolder)
  const [link, setLink] = useState("")
  const [linkError, setLinkError] = useState<string | null>(null)
  const [browserNotes, setBrowserNotes] = useState<number | null>(null)
  const [folderNotes, setFolderNotes] = useState<number | null>(null)
  const [migrate, setMigrate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [confirmCopy, setConfirmCopy] = useState(false)
  const pending = useSync((s) => s.pending)
  const supported = fsaSupported() || isTauri()
  const inFolder = adapter?.kind === "folder"
  const inRemote = adapter?.kind === "remote"
  const inBrowser = !inFolder && !inRemote

  useEffect(() => {
    void init()
    countNotes(createBrowserAdapter()).then(setBrowserNotes, () => setBrowserNotes(0))
  }, [init])

  useEffect(() => {
    if (adapter?.kind !== "folder") return
    countNotes(adapter).then(setFolderNotes, () => setFolderNotes(0))
  }, [adapter])

  const connect = async () => {
    setBusy(true)
    try {
      const res = await connectFolder(migrate && !!browserNotes)
      if (!res) return
      toast.success("Папка подключена", {
        description: res.copied ? `Скопировано файлов: ${res.copied}` : undefined,
      })
      navigate("/")
    } catch (e) {
      toast.error("Не удалось подключить папку", { description: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const connectServer = async () => {
    setLinkError(null)
    let config
    try {
      config = parseRemoteLink(link)
    } catch (e) {
      setLinkError(errorText(e))
      return
    }
    if (blockedAsMixedContent(config)) {
      setLinkError(MIXED_CONTENT_HINT)
      return
    }
    setBusy(true)
    try {
      const res = await connectRemote(config, migrate && ((inBrowser && !!browserNotes) || (inFolder && !!folderNotes)))
      toast.success("Сервер подключён", {
        description: res.copied ? `Скопировано файлов: ${res.copied}` : undefined,
      })
      setLink("")
      navigate("/")
    } catch (e) {
      setLinkError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const copyServer = async () => {
    setConfirmCopy(false)
    setBusy(true)
    try {
      const res = await copyToFolder()
      if (!res) return
      toast.success(`Скопировано в папку «${res.folder}»`, {
        description: `Скопировано файлов: ${res.copied}`,
      })
    } catch (e) {
      toast.error("Не удалось скопировать в папку", { description: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await switchToBrowser()
      toast(inRemote ? "Сервер отключён" : "Папка отключена")
      navigate("/")
    } catch (e) {
      toast.error("Не удалось отключить", { description: errorText(e) })
    } finally {
      setBusy(false)
      setConfirmDisconnect(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div aria-hidden className="ambient">
        <Nebula />
      </div>
      <motion.div
        variants={listParent}
        initial="hidden"
        animate="show"
        className="glass w-full max-w-md rounded-[var(--radius-surface)] p-8"
      >
        {status === "ready" && (
          <Link to="/" className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Назад
          </Link>
        )}
        <div className="text-center">
          <motion.span
            variants={listItem}
            className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground shadow-card"
          >
            К
          </motion.span>
          <motion.h1 variants={listItem} className="mt-5 text-[24px] font-bold tracking-tight">
            Хранилище
          </motion.h1>
        </div>

        <motion.div variants={listItem} className="mt-5 flex items-center gap-3 rounded-xl border px-3 py-2.5 text-[14px]">
          {inFolder ? (
            <FolderOpen className="size-4 shrink-0 text-highlight" />
          ) : inRemote ? (
            <Server className="size-4 shrink-0 text-highlight" />
          ) : (
            <MonitorSmartphone className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">
            Сейчас: <b className="font-semibold">{storageLabel(adapter) ?? "хранилище браузера"}</b>
            {adapter instanceof SyncedAdapter && (
              <span className="block truncate text-[12px] text-muted-foreground">{adapter.config.url}</span>
            )}
          </span>
          {!inBrowser && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
              Отключить
            </Button>
          )}
        </motion.div>

        {inRemote && (
          <motion.div variants={listItem} className="mt-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !supported}
              onClick={() => setConfirmCopy(true)}
              className="w-full justify-start"
            >
              <FolderDown /> Скопировать в папку
            </Button>
          </motion.div>
        )}

        {!supported && (
          <motion.p
            variants={listItem}
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 px-3 py-2.5 text-[13px] text-destructive"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> Для доступа к папке открой приложение в Chrome или Edge по HTTPS или
            localhost.
          </motion.p>
        )}

        {inBrowser && !!browserNotes && (
          <motion.label
            variants={listItem}
            className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-[14px]"
          >
            <input
              type="checkbox"
              checked={migrate}
              onChange={(e) => setMigrate(e.target.checked)}
              className="mt-1 size-4 accent-(--highlight)"
            />
            <span>
              Скопировать данные из браузера
              <span className="block text-[13px] text-muted-foreground">
                {plural(browserNotes, ["конспект", "конспекта", "конспектов"])}. Существующие файлы не заменятся.
              </span>
            </span>
          </motion.label>
        )}

        {inFolder && !!folderNotes && (
          <motion.label
            variants={listItem}
            className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-[14px]"
          >
            <input
              type="checkbox"
              checked={migrate}
              onChange={(e) => setMigrate(e.target.checked)}
              className="mt-1 size-4 accent-(--highlight)"
            />
            <span>
              Скопировать папку «{adapter?.label}» на сервер
              <span className="block text-[13px] text-muted-foreground">
                {plural(folderNotes, ["конспект", "конспекта", "конспектов"])}. Существующие файлы на сервере не заменятся.
              </span>
            </span>
          </motion.label>
        )}

        <motion.div variants={listItem} className="mt-6 flex flex-col gap-2">
          <LiquidButton size="xl" className="w-full rounded-full font-semibold" disabled={!supported || busy} onClick={connect}>
            {busy ? <Loader2 className="animate-spin" /> : <FolderOpen />}
            {inFolder ? "Выбрать другую папку" : "Выбрать папку"}
          </LiquidButton>
          {inBrowser && (
            <Button size="lg" variant="ghost" onClick={() => navigate("/")}>
              Продолжить в браузере
            </Button>
          )}
        </motion.div>

        <motion.form
          variants={listItem}
          className="mt-6 border-t pt-5"
          onSubmit={(e) => {
            e.preventDefault()
            void connectServer()
          }}
        >
          <label htmlFor="storage-link" className="flex items-center gap-2 text-[14px] font-semibold">
            <Server className="size-4 text-highlight" /> {inRemote ? "Другой сервер" : "Сервер"}
          </label>
          <p className="mt-1 text-[13px] text-muted-foreground">Вставь ссылку подключения typos://.</p>
          <div className="mt-3 flex gap-2">
            <Input
              id="storage-link"
              value={link}
              onChange={(e) => {
                setLink(e.target.value)
                setLinkError(null)
              }}
              placeholder="typos://192.168.1.10:8787?…"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!linkError}
              aria-describedby={linkError ? "storage-link-error" : undefined}
              className="h-9 font-mono text-[13px]"
            />
            <Button type="submit" size="lg" disabled={busy || !link.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : "Подключить"}
            </Button>
          </div>
          {linkError && (
            <p id="storage-link-error" role="alert" className="mt-2 flex items-start gap-2 text-[13px] text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {linkError}
            </p>
          )}
        </motion.form>
      </motion.div>

      <Dialog open={confirmCopy} onOpenChange={(o) => !o && setConfirmCopy(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Скопировать в папку?</DialogTitle>
            <DialogDescription>
              Файлы с сервера «{adapter?.label}» скопируются в выбранную папку. Файлы с совпадающими именами
              <b className="font-semibold text-foreground"> заменятся</b>. Подключение к серверу сохранится.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmCopy(false)}>
              Отмена
            </Button>
            <Button disabled={busy} onClick={copyServer}>
              <FolderDown /> Выбрать папку
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDisconnect} onOpenChange={(o) => !o && setConfirmDisconnect(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{inRemote ? `Отключиться от сервера «${adapter?.label}»?` : `Отключить папку «${adapter?.label}»?`}</DialogTitle>
            <DialogDescription>
              {inRemote ? "Файлы останутся на сервере." : "Файлы останутся в папке."}{" "}
              {inRemote && pending > 0 && (
                <b className="font-semibold text-foreground">
                  {plural(pending, ["правка не отправлена", "правки не отправлены", "правок не отправлено"])}. Изменения останутся на
                  устройстве до повторного подключения.{" "}
                </b>
              )}
              Откроется хранилище браузера.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>
              Отмена
            </Button>
            <Button disabled={busy} onClick={disconnect}>
              {busy && <Loader2 className="animate-spin" />}
              Отключить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
