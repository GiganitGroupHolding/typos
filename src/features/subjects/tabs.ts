import type { SubjectTab } from "@/types"

export const tabOfPath = (pathname: string): SubjectTab =>
  pathname.includes("/t/") ? "tools" : pathname.includes("/b/") ? "boards" : "notes"
