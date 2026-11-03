import { isTauri } from "@tauri-apps/api/core"
import { Minus, Plus, Settings } from "lucide-react"
import { useUi } from "@/app/store"
import { Button } from "@/components/ui/Button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/Dialog"
import { SidebarMenuButton } from "@/components/ui/Sidebar"
import { SUBJECT_COLORS } from "@/lib/subjectPalette"

export function SettingsDialog() {
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const backdrop = useUi((s) => s.backdrop)
  const setBackdrop = useUi((s) => s.setBackdrop)
  const responsive = useUi((s) => s.responsiveAccent)
  const setResponsive = useUi((s) => s.setResponsiveAccent)
  const color = useUi((s) => s.fixedAccent)
  const setColor = useUi((s) => s.setFixedAccent)
  const zoom = useUi((s) => s.desktopZoom)
  const setZoom = useUi((s) => s.setDesktopZoom)
  return (
    <Dialog>
      <DialogTrigger asChild>
        <SidebarMenuButton>
          <Settings />
          <span>Настройки</span>
        </SidebarMenuButton>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Настройки</DialogTitle>
          <DialogDescription>Оформление сохраняется на этом устройстве.</DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-medium">Тема</legend>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ["light", "Светлая"],
                ["dark", "Тёмная"],
                ["system", "Как в системе"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={theme === value ? "default" : "outline"}
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-medium">Фон</legend>
          <div className="flex gap-1">
            {(
              [
                ["nebula", "Туманность"],
                ["metal", "Металл"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={backdrop === value ? "default" : "outline"}
                aria-pressed={backdrop === value}
                onClick={() => setBackdrop(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-3">
          <legend className="mb-2 font-medium">Акцентный цвет</legend>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={responsive} onChange={(event) => setResponsive(event.target.checked)} />
            Цвет по предмету
          </label>
          <p className="text-xs text-muted-foreground">
            {responsive ? "Акцент меняется под цвет открытого предмета." : "Один цвет для всех предметов и общего экрана."}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Палитра акцента">
            {SUBJECT_COLORS.map((swatch) => (
              <button
                key={swatch.id}
                type="button"
                disabled={responsive}
                aria-label={swatch.name}
                className="size-6 rounded-full border border-foreground/20 outline-offset-2 focus-visible:outline-2 disabled:opacity-35"
                style={{ background: `var(--subject-${swatch.id})` }}
                onClick={() => {
                  const probe = document.createElement("canvas").getContext("2d")
                  if (!probe) return
                  probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(`--subject-${swatch.id}`).trim()
                  probe.fillRect(0, 0, 1, 1)
                  const rgb = probe.getImageData(0, 0, 1, 1).data
                  setColor("#" + Array.from(rgb.slice(0, 3), (value) => value.toString(16).padStart(2, "0")).join(""))
                }}
              />
            ))}
          </div>
          <label className="flex items-center justify-between gap-3">
            Свой цвет
            <input
              type="color"
              aria-label="Свой цвет"
              value={color}
              disabled={responsive}
              onInput={(event) => setColor(event.currentTarget.value)}
              className="h-8 w-12 cursor-pointer disabled:opacity-35"
            />
          </label>
        </fieldset>
        {isTauri() && (
          <fieldset className="grid gap-2">
            <legend className="mb-2 font-medium">Масштаб интерфейса</legend>
            <div className="flex items-center gap-2">
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="Уменьшить масштаб"
                disabled={zoom <= 50}
                onClick={() => setZoom(zoom - 10)}
              >
                <Minus />
              </Button>
              <output className="min-w-12 text-center tabular-nums" aria-live="polite">
                {zoom}%
              </output>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="Увеличить масштаб"
                disabled={zoom >= 200}
                onClick={() => setZoom(zoom + 10)}
              >
                <Plus />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setZoom(100)}>
                Сбросить
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Ctrl + / − · Ctrl 0 — вернуть 100%</p>
          </fieldset>
        )}
      </DialogContent>
    </Dialog>
  )
}
