import type { Pin } from "@/types"

/** Старые закрепы без настройки продолжают участвовать в повторении. */
export const isQuizPin = (pin: Pin) => pin.kind !== "link" && pin.quiz !== false

export function pinUrl(value?: string): string | undefined {
  const text = value?.trim()
  if (!text || Array.from(text).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return undefined
  try {
    const url = new URL(text.startsWith("//") ? `https:${text}` : /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`)
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname && !url.username && !url.password ? url.href : undefined
  } catch {
    return undefined
  }
}

export function pinFavicon(value?: string): string | undefined {
  const url = pinUrl(value)
  return url ? new URL("/favicon.ico", new URL(url).origin).href : undefined
}
