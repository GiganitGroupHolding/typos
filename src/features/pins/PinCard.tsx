import { Globe, Link2 } from "lucide-react"
import { useState } from "react"
import { subjectIcons } from "@/features/subjects/visuals"
import { pinFavicon, pinUrl } from "@/lib/pins"
import { Tex } from "@/lib/Tex"
import { cn } from "@/lib/utils"
import type { Pin } from "@/types"

export function PinLinkIcon({ icon, url, large = false }: Pick<Pin, "icon" | "url"> & { large?: boolean }) {
  const favicon = icon === "favicon" || !icon ? pinFavicon(url) : undefined
  const [failed, setFailed] = useState<string>()
  const Icon = icon && icon !== "favicon" ? (subjectIcons[icon] ?? Globe) : Globe
  return (
    <span
      data-pin-link-icon=""
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full border bg-accent text-highlight",
        large ? "size-14" : "size-10",
      )}
    >
      {favicon && failed !== favicon ? (
        <img
          src={favicon}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          draggable={false}
          onError={() => setFailed(favicon)}
          className={cn("object-contain", large ? "size-7" : "size-5")}
        />
      ) : (
        <Icon aria-hidden className={large ? "size-7" : "size-5"} />
      )}
      <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground">
        <Link2 aria-hidden className="size-2.5" />
      </span>
    </span>
  )
}

export function PinBody({ pin, size = "md", hideTitle = false }: { pin: Pin; size?: "sm" | "md" | "lg"; hideTitle?: boolean }) {
  if (pin.kind === "link")
    return (
      <a
        data-ui-hover={pinUrl(pin.url) ? "pin-link" : undefined}
        href={pinUrl(pin.url)}
        target="_blank"
        rel="noopener noreferrer"
        title={pin.url}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PinLinkIcon icon={pin.icon} url={pin.url} large={size === "lg"} />
        <span
          className={cn("min-w-0 break-words font-semibold", size === "lg" ? "text-[18px]" : size === "sm" ? "text-[13px]" : "text-[14px]")}
        >
          {pin.title}
        </span>
      </a>
    )
  return (
    <>
      {!hideTitle && <div className={cn("font-semibold", size === "sm" ? "text-[13px]" : "text-[14px]")}>{pin.title}</div>}
      {pin.tex && (
        <div className={cn("thin-scrollbar overflow-x-auto py-2", size === "sm" ? "text-[14px]" : "text-[16px]")}>
          <Tex tex={pin.tex} block />
        </div>
      )}
      {pin.text && <p className="text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground">{pin.text}</p>}
    </>
  )
}
