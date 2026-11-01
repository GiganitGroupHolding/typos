import { createStore } from 'idb-keyval'

export const settingsStore = createStore('studynotes-settings', 'kv')
