import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { sampleVault } from '@/test/sampleVault'
import { serializeFrontmatter } from './format'
import * as repo from './repo'
import { NoteConflictError, useVault } from './store'

let a: ReturnType<typeof sampleVault>

beforeEach(async () => {
  a = sampleVault()
  useVault.setState({ ...(await repo.loadVault(a)), adapter: a, status: 'ready' })
})

const firstNote = () => useVault.getState().notes[0]
/** Кто-то снаружи (Claude, MCP) переписал файл конспекта. */
const writeOutside = async (body: string) => {
  const n = firstNote()
  await a.writeText(n.path, serializeFrontmatter({ id: n.id, created: n.created, updated: n.updated }, body))
}

describe('сохранение конспекта и правки снаружи', () => {
  it('обычные сохранения подряд не считаются конфликтом', async () => {
    const n = firstNote()
    const { saveNote, adoptNote } = useVault.getState()
    adoptNote(n.id, n.body)
    await Promise.all([saveNote(n.id, `${n.body}\n\nраз`), saveNote(n.id, `${n.body}\n\nраз два`)])
    expect(await repo.readNoteBody(a, firstNote().path)).toBe(`${n.body}\n\nраз два`)
  })

  it('файл поменяли снаружи — не перезаписывает, а бросает конфликт', async () => {
    const n = firstNote()
    useVault.getState().adoptNote(n.id, n.body)
    await writeOutside('# Дописал Claude')
    await expect(useVault.getState().saveNote(n.id, `${n.body}\n\nмоя правка`)).rejects.toBeInstanceOf(NoteConflictError)
    expect(await repo.readNoteBody(a, n.path)).toBe('# Дописал Claude')
  })

  it('перечитывание папки не прячет конфликт', async () => {
    const n = firstNote()
    useVault.getState().adoptNote(n.id, n.body)
    await writeOutside('# Дописал Claude')
    await useVault.getState().refresh()
    expect(firstNote().body).toBe('# Дописал Claude')
    await expect(useVault.getState().saveNote(n.id, `${n.body}\n\nмоя правка`)).rejects.toBeInstanceOf(NoteConflictError)
  })

  it('после «взять с диска» правки сохраняются; force — пишет поверх', async () => {
    const n = firstNote()
    const s = useVault.getState()
    s.adoptNote(n.id, n.body)
    await writeOutside('# Дописал Claude')
    s.adoptNote(n.id, '# Дописал Claude')
    await s.saveNote(n.id, '# Дописал Claude\n\nи я')
    expect(await repo.readNoteBody(a, firstNote().path)).toBe('# Дописал Claude\n\nи я')

    await writeOutside('# Снова снаружи')
    await s.saveNote(n.id, '# Моя версия', { force: true })
    expect(await repo.readNoteBody(a, firstNote().path)).toBe('# Моя версия')
  })
})
