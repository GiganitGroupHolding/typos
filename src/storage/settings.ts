import { createStore } from 'idb-keyval'

/** Настройки приложения в IndexedDB: какое хранилище открыто (хэндл папки, подключение к серверу). */
export const settingsStore = createStore('studynotes-settings', 'kv')
