import { describe, expect, it } from 'vitest'
import { guessToolName } from '@/vault/repo'
import { fileExt, fileTitle, safeName } from './VaultAdapter'

describe('имена при импорте', () => {
  it('кириллица и пробелы остаются как есть', () => {
    expect(fileTitle('Лекция 3 — Фирма в рыночной экономике.md')).toBe('Лекция 3 — Фирма в рыночной экономике')
    expect(safeName('Модель концентрических кругов Тросби')).toBe('Модель концентрических кругов Тросби')
  })

  it('имена из macOS (NFD) собираются обратно в обычные буквы', () => {
    const nfd = 'Мой конспект ёлки.md'.normalize('NFD')
    expect(nfd).not.toBe('Мой конспект ёлки.md')
    expect(fileTitle(nfd)).toBe('Мой конспект ёлки')
    expect(safeName(nfd)).toBe('Мой конспект ёлки.md')
  })

  it('запрещённые в Windows символы убираются, остальное нет', () => {
    expect(safeName('Тема: спрос/предложение?')).toBe('Тема спрос предложение')
    expect(safeName('  много   пробелов  ')).toBe('много пробелов')
  })

  it('расширение и путь', () => {
    expect(fileTitle('C:\\Users\\Даня\\Загрузки\\План работ.v2.pdf')).toBe('План работ.v2')
    expect(fileExt('Слайды.PPTX')).toBe('pptx')
    expect(fileExt('без расширения')).toBe('')
  })

  it('название HTML — из имени файла, <title> только для безликих имён', () => {
    const html = '<html><head><title>Untitled document</title></head></html>'
    expect(guessToolName(html, 'Калькулятор интегралов.html')).toBe('Калькулятор интегралов')
    expect(guessToolName('<title>Решатель СЛАУ</title>', 'index.html')).toBe('Решатель СЛАУ')
    expect(guessToolName('<title>Решатель СЛАУ</title>', 'document (2).html')).toBe('Решатель СЛАУ')
  })
})
