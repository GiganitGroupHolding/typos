import { createStore, del, delMany, get, keys, set } from "idb-keyval"
import { FlatAdapter } from "./flatAdapter"

export function createBrowserAdapter() {
  const store = createStore("studynotes-vault", "files")
  return new FlatAdapter(
    {
      get: (p) => get<string | Blob>(p, store),
      set: (p, v) => set(p, v, store),
      del: (ps) => (ps.length === 1 ? del(ps[0], store) : delMany(ps, store)),
      keys: async () => (await keys(store)).map(String),
    },
    "browser",
    "Браузер",
  )
}
