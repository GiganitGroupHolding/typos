import type { KeyboardEvent } from "react"

export function submitOnCtrlEnter(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    event.currentTarget.requestSubmit()
  }
}
