import { describe, expect, it } from 'vitest'
import { TOOL_CSP, withCsp } from './sandbox'

function parse(html: string) {
  const doc = new DOMParser().parseFromString(withCsp(html), 'text/html')
  const csp = [...doc.head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')]
  return { doc, csp, first: doc.querySelector('meta, script, link, style, base, iframe') }
}

describe('CSP тулз', () => {
  const cases = {
    'обычный документ': '<!doctype html><html><head><title>x</title><script>1</script></head><body></body></html>',
    '<head> в комментарии': '<!doctype html><!-- <head> --><html><head><script>fetch("https://evil")</script></head></html>',
    '<head> в строке скрипта': '<script>const s = "<head>"</script><p>x</p>',
    'без head и html': '<script>1</script><p>тулза</p>',
    'только html': '<html lang="ru"><body><script>1</script></body></html>',
    'BOM и пробелы': '﻿  \n<!DOCTYPE html>\n<html><head><script>1</script></head></html>',
    'meta до html-тега': '<meta charset="utf-8"><script>1</script>',
    '<base> в начале': '<base href="https://evil/"><script src="x.js"></script>',
  }

  for (const [name, html] of Object.entries(cases)) {
    it(`политика действует до первого тега: ${name}`, () => {
      const { csp, first } = parse(html)
      expect(csp).toHaveLength(1)
      expect(csp[0].getAttribute('content')).toBe(TOOL_CSP)
      expect(first).toBe(csp[0])
    })
  }

  it('doctype остаётся первым — режим вёрстки не меняется', () => {
    const { doc } = parse('<!DOCTYPE html><html><head></head><body>x</body></html>')
    expect(doc.doctype?.name).toBe('html')
    expect(doc.compatMode).toBe('CSS1Compat')
  })

  it('атрибуты <html> тулзы сохраняются', () => {
    const { doc } = parse('<!doctype html><html lang="ru" data-theme="dark"><head></head></html>')
    expect(doc.documentElement.getAttribute('lang')).toBe('ru')
    expect(doc.documentElement.dataset.theme).toBe('dark')
  })
})
