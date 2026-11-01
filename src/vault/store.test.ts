import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseBoard, serializeBoard } from '@/features/boards/model'
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

describe('сохранение доски и правки снаружи', () => {
  it('правку снаружи (MCP) не затирает: сливает со своей', async () => {
    const subject = useVault.getState().subjects[0]
    const s = useVault.getState()
    const b = await s.createBoard(subject.id, 'Схема')
    const mine = { id: 'm', type: 'text' as const, x: 0, y: 0, width: 200, height: 80, text: 'моя' }
    const theirs = { id: 't', type: 'text' as const, x: 300, y: 0, width: 200, height: 80, text: 'от Claude' }
    s.adoptBoard(b.id, b.data)
    await a.writeText(b.path, serializeBoard(b.id, { nodes: [theirs], edges: [] }))

    const saved = await s.saveBoard(b.id, { nodes: [mine], edges: [] })
    expect(saved?.nodes.map((n) => n.id)).toEqual(['m', 't'])
    expect(parseBoard(await a.readText(b.path)).data.nodes.map((n) => n.text)).toEqual(['моя', 'от Claude'])

    await s.saveBoard(b.id, { nodes: [{ ...mine, x: 40 }, theirs], edges: [] })
    expect(parseBoard(await a.readText(b.path)).data.nodes.map((n) => [n.id, n.x])).toEqual([
      ['m', 40],
      ['t', 300],
    ])
  })
})
