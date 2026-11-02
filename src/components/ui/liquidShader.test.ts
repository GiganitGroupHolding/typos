import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Mesh, Scene, ShaderMaterial, WebGLRenderTarget } from 'three'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InteractiveNebulaShader } from './liquid-shader'

const renderer = vi.hoisted(() => ({
  draw: vi.fn<(scene: Scene) => void>(),
  resize: vi.fn(),
  target: vi.fn<(target: WebGLRenderTarget | null) => void>(),
  loop: null as ((time: number) => void) | null,
}))
vi.mock('three', async (original) => ({
  ...(await original<typeof import('three')>()),
  WebGLRenderer: class {
    domElement = document.createElement('canvas')
    render = renderer.draw
    setRenderTarget = renderer.target
    dispose() {}
    setAnimationLoop(callback: typeof renderer.loop) {
      renderer.loop = callback
    }
    setDrawingBufferSize(width: number, height: number, ratio: number) {
      renderer.resize(width, height, ratio)
      this.domElement.width = Math.floor(width * ratio)
      this.domElement.height = Math.floor(height * ratio)
    }
  },
}))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let root: Root
let host: HTMLDivElement
let width: number
let height: number
let reduced: boolean
let hidden: boolean

beforeEach(() => {
  vi.clearAllMocks()
  width = 1280
  height = 720
  reduced = false
  hidden = false
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const uniforms = () => ((renderer.draw.mock.calls[0][0].children[0] as Mesh).material as ShaderMaterial).uniforms

it.each(['nebula', 'metal'] as const)('объявляет размер массивов в шейдере фона «%s»', async (variant) => {
  await act(async () => root.render(createElement(InteractiveNebulaShader, { variant })))
  renderer.loop?.(0)
  const material = (renderer.draw.mock.calls[0][0].children[0] as Mesh).material as ShaderMaterial
  const define = material.fragmentShader.match(/^\s*#define\s+MAX\s+(\d+)\s*$/m)
  expect(define).not.toBeNull()
  expect(Number(define![1])).toBe(material.uniforms.uSpots.value.length)
})

it('рисует движение на каждом кадре экрана без ограничения в 30 кадров', async () => {
  await act(async () => root.render(createElement(InteractiveNebulaShader)))
  for (let frame = 0; frame < 12; frame++) renderer.loop?.((frame * 1000) / 120)
  expect(renderer.draw).toHaveBeenCalledTimes(24)
  expect(uniforms().iTime.value).toBeCloseTo(11 / 120)
  const time = uniforms().uSpots.value[0].w
  expect(uniforms().uRotation.value[0].toArray()).toEqual([
    Math.cos(time * 0.4),
    Math.sin(time * 0.4),
    Math.cos(time * 0.3),
    Math.sin(time * 0.3),
  ])
})

it('масштабирование не перемешивает пятна и не пересоздаёт буфер того же размера', async () => {
  const random = vi.spyOn(Math, 'random')
  await act(async () => root.render(createElement(InteractiveNebulaShader)))
  renderer.loop?.(0)
  const positions = uniforms().uSpots.value.map((spot: { x: number; y: number; z: number }) => [spot.x, spot.y, spot.z])
  const count = random.mock.calls.length
  width /= 2
  height /= 2
  vi.stubGlobal('devicePixelRatio', 2)
  window.dispatchEvent(new Event('resize'))
  renderer.loop?.(16)
  expect(random).toHaveBeenCalledTimes(count)
  expect(uniforms().uSpots.value.map((spot: { x: number; y: number; z: number }) => [spot.x, spot.y, spot.z])).toEqual(positions)
  expect(renderer.resize).toHaveBeenCalledOnce()
  expect(uniforms().iResolution.value.toArray()).toEqual([640, 360])
  width = 900
  height = 900
  window.dispatchEvent(new Event('resize'))
  renderer.loop?.(32)
  expect(random).toHaveBeenCalledTimes(count)
  const [firstX, firstY] = positions[0]
  expect(uniforms().uSpots.value[0].x).toBeCloseTo((firstX * 720) / 1280)
  expect(uniforms().uSpots.value[0].y).toBeCloseTo(firstY)
})

it('ограничивает число пикселей на большом экране с высоким DPR', async () => {
  width = 3840
  height = 2160
  vi.stubGlobal('devicePixelRatio', 4)
  await act(async () => root.render(createElement(InteractiveNebulaShader)))
  const canvas = host.querySelector('canvas')!
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(2_073_600)
  expect(canvas.width / canvas.height).toBeCloseTo(width / height, 2)
})

it('масштаб 130% сохраняет нативную плотность и не увеличивает пиксели фона', async () => {
  width = 1000
  height = 600
  vi.stubGlobal('devicePixelRatio', 1.3)
  await act(async () => root.render(createElement(InteractiveNebulaShader)))
  const canvas = host.querySelector('canvas')!
  expect([canvas.width, canvas.height]).toEqual([1300, 780])
  renderer.loop?.(0)
  const positions = uniforms().uSpots.value.map((spot: { x: number; y: number }) => [spot.x, spot.y])
  width *= 1.3
  height *= 1.3
  vi.stubGlobal('devicePixelRatio', 1)
  window.dispatchEvent(new Event('resize'))
  renderer.loop?.(16)
  expect([canvas.width, canvas.height]).toEqual([1300, 780])
  expect(renderer.resize).toHaveBeenCalledOnce()
  expect(uniforms().uSpots.value.map((spot: { x: number; y: number }) => [spot.x, spot.y])).toEqual(positions)
})

it('движение металла рассчитывается один раз на пятно и не меняет его форму', async () => {
  await act(async () => root.render(createElement(InteractiveNebulaShader, { variant: 'metal' })))
  renderer.loop?.(0)
  renderer.loop?.(16)
  const spot = uniforms().uSpots.value[0]
  expect(uniforms().uMetalSpots.value[0].toArray()).toEqual([
    spot.x + 0.016 * Math.sin(spot.w * 0.55),
    spot.y + 0.016 * Math.cos(spot.w * 0.42),
    (0.24 / spot.z) * (1 + 0.035 * Math.sin(spot.w * 0.8)),
  ])
})

it('скрытая вкладка не рисуется, а уменьшение движения оставляет фон статичным', async () => {
  reduced = true
  await act(async () => root.render(createElement(InteractiveNebulaShader)))
  renderer.loop?.(0)
  renderer.loop?.(16)
  expect(renderer.draw).toHaveBeenCalledTimes(2)
  hidden = true
  renderer.loop?.(500)
  expect(renderer.draw).toHaveBeenCalledTimes(2)
  hidden = false
  window.dispatchEvent(new Event('lava:shuffle'))
  renderer.loop?.(1000)
  expect(renderer.draw).toHaveBeenCalledTimes(4)
  expect(uniforms().iTime.value).toBe(0)
})

it('при медленных кадрах уменьшает только процедурную текстуру, сохраняя чёткость вывода', async () => {
  await act(async () => root.render(createElement(InteractiveNebulaShader)))
  renderer.loop?.(0)
  const texture = renderer.target.mock.calls[0][0]!
  const initialWidth = texture.width
  const canvas = host.querySelector('canvas')!
  for (let frame = 1; frame <= 30; frame++) renderer.loop?.(frame * 40)
  expect(texture.width).toBeLessThan(initialWidth)
  expect(texture.width * texture.height).toBeLessThanOrEqual(2_073_600)
  expect([canvas.width, canvas.height]).toEqual([1280, 720])
  expect(renderer.draw).toHaveBeenCalledTimes(62)
  const loweredWidth = texture.width
  for (let frame = 1; frame <= 250; frame++) renderer.loop?.(1200 + (frame * 1000) / 60)
  expect(texture.width).toBeGreaterThan(loweredWidth)
  expect([canvas.width, canvas.height]).toEqual([1280, 720])
})
