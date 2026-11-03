import { useLayoutEffect, useRef, useState } from "react"
import { useResolvedTheme } from "@/app/theme"
import { cn } from "@/lib/utils"
import { deviceFrame } from "./deviceFrame"
import { ToolFrame } from "./ToolFrame"

export interface DeviceFrame {
  src: string
  width: number
  height: number
  screen: { x: number; y: number; width: number; height: number; radius: number }
}

const SCREEN_W = 440
const SCREEN_H = 956
const STATUS_H = 62

const BARE = { width: SCREEN_W + 24, height: SCREEN_H + 24, screen: { x: 12, y: 12, width: SCREEN_W, height: SCREEN_H, radius: 62 } }

export function PhonePreview({ html, title, runKey }: { html: string; title: string; runKey?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  const theme = useResolvedTheme()

  const [missing, setMissing] = useState(false)
  const frame = missing ? null : deviceFrame

  const k = frame ? SCREEN_W / frame.screen.width : 1
  const g = frame ?? BARE
  const stageW = g.width * k
  const stageH = g.height * k
  const screenH = frame ? frame.screen.height * k : SCREEN_H

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(Math.min(1, (el.clientWidth - 32) / stageW, (el.clientHeight - 32) / stageH))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [stageW, stageH])

  return (
    <div ref={box} className="flex size-full items-center justify-center overflow-hidden">
      <div style={{ width: stageW * scale, height: stageH * scale }} className={cn("relative shrink-0", !scale && "invisible")}>
        <div style={{ width: stageW, height: stageH, transform: `scale(${scale})` }} className="absolute top-0 left-0 origin-top-left">
          <div
            style={{ left: g.screen.x * k, top: g.screen.y * k, width: SCREEN_W, height: screenH, borderRadius: g.screen.radius * k }}
            className={cn(
              "absolute flex flex-col overflow-hidden",
              theme === "dark" ? "bg-black text-white" : "bg-white text-black",
              !frame && "shadow-float ring-[10px] ring-neutral-900",
            )}
          >
            <StatusBar />
            {!frame && (
              <span aria-hidden className="absolute top-[11px] left-1/2 h-[37px] w-[125px] -translate-x-1/2 rounded-full bg-black" />
            )}

            <div className="min-h-0 flex-1">{scale > 0 && <ToolFrame html={html} title={title} runKey={runKey} />}</div>
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-2 left-1/2 h-[5px] w-[140px] -translate-x-1/2 rounded-full bg-current opacity-80"
            />
          </div>
          {frame && (
            <img
              src={frame.src}
              alt=""
              aria-hidden
              draggable={false}
              onError={() => setMissing(true)}
              className="pointer-events-none absolute inset-0 size-full select-none"
            />
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBar() {
  return (
    <div
      aria-hidden
      style={{ height: STATUS_H }}
      className="flex shrink-0 items-center justify-between px-[38px] pt-[14px] text-[17px] font-semibold tracking-tight select-none"
    >
      <span className="w-[78px] text-center tabular-nums">9:41</span>
      <span className="flex items-center gap-[7px]">
        <svg width="19" height="12" viewBox="0 0 19 12" fill="currentColor">
          <rect x="0" y="8" width="3.2" height="4" rx="1" />
          <rect x="5.2" y="5.5" width="3.2" height="6.5" rx="1" />
          <rect x="10.4" y="3" width="3.2" height="9" rx="1" />
          <rect x="15.6" y="0" width="3.2" height="12" rx="1" />
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor">
          <path d="M8.5 2.4c2.3 0 4.4.9 6 2.4l1.2-1.2A10.2 10.2 0 0 0 8.5.7 10.2 10.2 0 0 0 1.3 3.6l1.2 1.2a8.5 8.5 0 0 1 6-2.4Zm0 3.4c1.4 0 2.6.5 3.6 1.4l1.2-1.2a6.8 6.8 0 0 0-9.6 0l1.2 1.2c1-.9 2.2-1.4 3.6-1.4Zm0 3.4c.5 0 1 .2 1.3.5L8.5 11 7.2 9.7c.3-.3.8-.5 1.3-.5Z" />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" stroke="currentColor" opacity="0.4" />
          <rect x="2" y="2" width="20" height="9" rx="2.5" fill="currentColor" />
          <path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="currentColor" opacity="0.45" />
        </svg>
      </span>
    </div>
  )
}
