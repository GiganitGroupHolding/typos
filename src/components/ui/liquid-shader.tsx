import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js'

export type BackgroundVariant = 'nebula' | 'metal'

export interface InteractiveNebulaShaderProps {
  variant?: BackgroundVariant

  avoidText?: boolean
  disableCenterDimming?: boolean
  className?: string
}

const MAX = 10

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`

const fragmentShader = `
  #define MAX ${MAX}
  uniform vec2 iResolution;
  uniform vec4 uSpots[MAX];
  uniform vec4 uLook[MAX];
  uniform float uAlpha[MAX];
  uniform vec4 uRotation[MAX];
  uniform float uDrift[MAX];
  uniform vec3 uAvoid;
  uniform vec3 uBg;
  uniform vec3 uTintCol;
  uniform float uTint;
  uniform bool uLight;
  uniform bool disableCenterDimming;
  varying vec2 vUv;

  mat2 m(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  float map(vec3 p, float t, float seed, vec4 rotation, float drift) {
    p.xz *= mat2(rotation.x, -rotation.y, rotation.y, rotation.x);
    p.xy *= mat2(rotation.z, -rotation.w, rotation.w, rotation.z);
    vec3 q = p * 2. + t + seed;

    return length(p + vec3(drift)) * log(length(p) + 1.0)
         + sin(q.x + sin(q.z + sin(q.y))) * 0.5 - 1.0;
  }

  float nebula(vec2 uv, float t, float seed, vec4 rotation, float drift) {
    float col = 0.0;
    float d = 2.5;
    vec3 ray = normalize(vec3(uv, -1.));
    for (int i = 0; i <= 5; i++) {
      vec3 p = vec3(0, 0, 5.) + ray * d;
      float rz = map(p, t, seed, rotation, drift);
      float f = clamp((rz - map(p + 0.1, t, seed, rotation, drift)) * 0.5, -0.1, 1.0);
      float base = 0.35 + 5.0 * f;
      col = col * base + smoothstep(2.5, 0.0, rz) * 0.7 * base;
      d += min(rz, 1.0);
    }
    return 1.0 - exp(-max(col, 0.0) * 0.9);
  }

  void main() {
    vec2 fragCoord = vUv * iResolution;
    float mn = min(iResolution.x, iResolution.y);

    float clear = 1.0;
    if (uAvoid.z > 0.5) {
      float outside = max(uAvoid.x - fragCoord.x, fragCoord.x - uAvoid.y);
      clear = smoothstep(0.0, 56.0, outside);
    }

    float body = 0.0;
    float glint = 0.0;
    float edge = 0.0;
    vec3 edgeCol = vec3(0.0);
    if (clear > 0.001) {
      for (int s = 0; s < MAX; s++) {
        float a = uAlpha[s];
        if (a < 0.01) continue;
        vec4 sp = uSpots[s];
        vec2 uv = (fragCoord / mn - sp.xy) * sp.z;
        float dn = length(uv) / 0.62;
        if (dn > 1.0) continue;

        vec4 lk = uLook[s];
        vec2 ruv = m(lk.z) * uv;
        ruv.x *= lk.w;
        float v = nebula(ruv, sp.w, lk.y * 6.28318, uRotation[s], uDrift[s]);

        if (!disableCenterDimming) v *= mix(0.3, 1.0, smoothstep(uLook[s].x * 0.6, uLook[s].x, dn));
        float w = smoothstep(1.0, 0.5, dn) * a;

        float aa = fwidth(v) * 0.5;
        float e = smoothstep(0.16 - aa, 0.28 + aa, v) * (1.0 - smoothstep(0.3 - aa, 0.46 + aa, v));

        vec3 prism = mix(vec3(1.0), 0.5 + 0.5 * cos(6.28318 * (v * 0.8 + uLook[s].y + vec3(0.0, 0.33, 0.67))), 0.04);
        body += v * w;
        glint += smoothstep(0.42, 0.95, v) * w;
        edge += e * w;
        edgeCol += prism * e * w;
      }
    }
    body = clamp(body * clear, 0.0, 1.0);
    glint = clamp(glint * clear, 0.0, 1.0);
    vec3 ec = edgeCol / max(edge, 0.001);
    edge = clamp(edge * clear, 0.0, 1.0);

    vec3 tint = mix(vec3(1.0), uTintCol, uTint);
    vec3 o;
    if (uLight) {

      o = uBg * (1.0 - 0.12 * body);
      o = mix(o, uBg * 0.82, edge * 0.32);
      o = mix(o, ec * 0.9, edge * 0.04);
      o = mix(o, uTintCol, (body * 0.22 + glint * 0.18) * uTint);
    } else {

      o = uBg + body * 0.07;
      o = mix(o, ec, edge * 0.3);
      o += tint * glint * 0.55;
      o = mix(o, uTintCol, body * 0.16 * uTint);
    }
    gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
  }
`

const metalShader = `
  #define MAX ${MAX}
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec4 uSpots[MAX];
  uniform vec3 uMetalSpots[MAX];
  uniform float uAlpha[MAX];
  uniform vec3 uAvoid;
  uniform vec3 uBg;
  uniform vec3 uTintCol;
  uniform float uTint;
  uniform bool uLight;
  varying vec2 vUv;

  float band(float x) {
    float g = 0.5 + 0.5 * cos(6.28318 * x);
    return smoothstep(0.04, 0.96, g);
  }

  void main() {
    vec2 fragCoord = vUv * iResolution;
    float mn = min(iResolution.x, iResolution.y);
    vec2 p = fragCoord / mn;

    float clear = 1.0;
    if (uAvoid.z > 0.5) {
      float outside = max(uAvoid.x - fragCoord.x, fragCoord.x - uAvoid.y);
      clear = smoothstep(0.0, 56.0, outside);
    }

    if (clear <= 0.001) {
      gl_FragColor = vec4(uBg, 1.0);
      return;
    }

    float F = 0.0;
    vec2 G = vec2(0.0);
    float S = 0.0;
    vec2 shadowOff = vec2(0.012, -0.022);
    for (int s = 0; s < MAX; s++) {
      float a = uAlpha[s];
      if (a < 0.01) continue;
      vec2 c = uMetalSpots[s].xy;
      float r = uMetalSpots[s].z;
      vec2 d = p - c;
      float dd = dot(d, d) + 1e-5;
      float k = a * r * r;
      F += k / dd;
      G += -2.0 * k * d / (dd * dd);
      vec2 ds = d - shadowOff;
      S += k / (dot(ds, ds) + 1e-5);
    }

    float e = max(fwidth(F), 0.001);
    float inside = smoothstep(1.0 - e, 1.0 + e, F) * clear;
    float shadow = smoothstep(0.55, 1.0, S) * (1.0 - inside) * clear;

    float contact = smoothstep(0.8, 1.0, S) * (1.0 - inside) * clear;
    vec3 bg = uBg * (1.0 - shadow * (uLight ? 0.12 : 0.35) - contact * (uLight ? 0.1 : 0.18));
    if (inside <= 0.001) {
      gl_FragColor = vec4(bg, 1.0);
      return;
    }

    float h = sqrt(clamp(1.0 - 1.0 / max(F, 1.0), 0.0, 1.0));

    vec2 outward = -G / max(length(G), 1e-5);
    vec3 n = normalize(vec3(outward * sqrt(max(1.0 - h * h, 0.0)), max(h, 0.001)));
    vec3 reflected = reflect(vec3(0.0, 0.0, -1.0), n);

    float coord = dot(reflected.xy, vec2(0.55, 0.85)) * 0.48 + reflected.z * 0.22 + iTime * 0.018;
    float rep = 1.0;

    float shift = 0.006 + 0.03 * pow(1.0 - h, 2.0);
    vec3 stripes = vec3(band((coord + shift) * rep), band(coord * rep), band((coord - shift) * rep));
    vec3 metal = mix(vec3(0.16), vec3(0.92), stripes);

    float fres = pow(1.0 - n.z, 2.0);
    metal = mix(metal, vec3(0.98), fres * 0.35);
    vec3 L = normalize(vec3(-0.45, 0.6, 0.66));
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 36.0);
    metal *= 0.72 + 0.28 * max(dot(n, L), 0.0);
    metal += spec * 0.7;

    float softbox = pow(max(dot(reflected, normalize(vec3(-0.55, 0.75, 0.35))), 0.0), 12.0);
    metal += vec3(0.38, 0.4, 0.42) * softbox;
    float rim = pow(1.0 - n.z, 4.0);
    metal += rim * max(dot(outward, normalize(vec2(-0.6, 0.8))), 0.0) * 0.35;

    metal = mix(metal, metal * (uTintCol * 1.25 + 0.15), 0.7 * uTint);

    gl_FragColor = vec4(mix(bg, clamp(metal, 0.0, 1.0), inside), 1.0);
  }
`

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))
const REACH = 0.62

type Role = 'tl' | 'br' | 'mid'

interface Spot {
  x: number
  y: number
  z: number
  a: number
  role: Role
  speed: number

  look: [number, number, number, number]

  dest?: { x: number; y: number; z: number; role: 'tl' | 'br' }
}

const anchorAt = (role: 'tl' | 'br', W: number, H: number): [number, number] => (role === 'tl' ? [0.08, H - 0.08] : [W - 0.08, 0.08])

function near(role: 'tl' | 'br', W: number, H: number, rMin: number, rMax: number): [number, number] {
  const [ax, ay] = anchorAt(role, W, H)
  const ang = rand(0, Math.PI / 2) + (role === 'tl' ? -Math.PI / 2 : Math.PI / 2)
  const r = rand(rMin, rMax)
  return [Math.min(Math.max(ax + Math.cos(ang) * r, -0.1), W + 0.1), Math.min(Math.max(ay + Math.sin(ang) * r, -0.1), H + 0.1)]
}

const look = (): [number, number, number, number] => [rand(0.36, 0.44), Math.random(), rand(0, Math.PI * 2), Math.random() < 0.5 ? -1 : 1]

function anchoredLayout(W: number, H: number): Spot[] {
  const spots: Spot[] = []
  const [tlx, tly] = anchorAt('tl', W, H)
  const [brx, bry] = anchorAt('br', W, H)
  for (const role of ['tl', 'br'] as const) {
    const [x, y] = near(role, W, H, 0, 0.12)
    spots.push({ x, y, z: rand(0.8, 1.2), a: 1, role, speed: rand(0.85, 1.15), look: look() })
    for (let i = randInt(0, 3); i > 0; i--) {
      const [sx, sy] = near(role, W, H, 0.25, 0.7)
      spots.push({ x: sx, y: sy, z: rand(1.6, 3.6), a: 1, role, speed: rand(0.8, 1.2), look: look() })
    }
  }
  for (let i = randInt(0, 4); i > 0 && spots.length < MAX; i--) {
    const x = rand(0.22, 0.78) * W
    const y = rand(0.18, 0.82) * H
    const toTl = Math.hypot(x - tlx, y - tly) < Math.hypot(x - brx, y - bry)
    const [dx, dy] = near(toTl ? 'tl' : 'br', W, H, 0.2, 0.5)
    spots.push({
      x,
      y,
      z: rand(1.4, 3.2),
      a: 1,
      role: 'mid',
      speed: rand(0.8, 1.2),
      look: look(),
      dest: { x: dx, y: dy, z: rand(2.2, 3.6), role: toTl ? 'tl' : 'br' },
    })
  }
  while (spots.length < MAX) spots.push({ x: rand(0, W), y: rand(0, H), z: 3, a: 0, role: 'mid', speed: 1, look: look() })
  return spots.slice(0, MAX)
}

function noteLayout(free: Spot[], W: number, band: [number, number] | null, gap: number): Spot[] {
  return free.map((s) => {
    if (s.a < 0.01) return { ...s }
    const spot: Spot = s.dest ? { ...s, ...s.dest } : { ...s }
    if (!band) return spot
    const [x0, x1] = band
    const r = REACH / spot.z
    if (spot.x + r <= x0 - gap || spot.x - r >= x1 + gap) return spot
    const left = spot.role === 'tl'

    const room = left ? x0 - gap + 0.1 : W + 0.1 - (x1 + gap)
    const fit = Math.max(Math.min(r, room / 2), 0.05)
    const x = left ? Math.min(spot.x, x0 - gap - fit) : Math.max(spot.x, x1 + gap + fit)
    return { ...spot, x, z: REACH / fit }
  })
}

function oklch(L: number, C: number, hDeg: number): THREE.Vector3 {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const enc = (x: number) => {
    const c = Math.min(Math.max(x, 0), 1)
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
  }
  return new THREE.Vector3(enc(lin[0]), enc(lin[1]), enc(lin[2]))
}

function appBackground(): THREE.Vector3 {
  const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)
  const [r, g, b] = (m ?? ['250', '249', '246']).map(Number)
  return new THREE.Vector3(r / 255, g / 255, b / 255)
}

export function InteractiveNebulaShader({
  variant = 'nebula',
  avoidText = false,
  disableCenterDimming = false,
  className = '',
}: InteractiveNebulaShaderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const avoidRef = useRef(avoidText)
  const kick = useRef<() => void>(() => {})
  const variantRef = useRef(variant)
  const swap = useRef<() => void>(() => {})

  useEffect(() => {
    variantRef.current = variant
    swap.current()
  }, [variant])

  useEffect(() => {
    avoidRef.current = avoidText
    kick.current()
  }, [avoidText])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
      })
    } catch {
      return
    }
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const uniforms = {
      iResolution: { value: new THREE.Vector2() },
      iTime: { value: 0 },
      uSpots: { value: Array.from({ length: MAX }, () => new THREE.Vector4(0.5, 0.5, 3, rand(0, 50))) },
      uMetalSpots: { value: Array.from({ length: MAX }, () => new THREE.Vector3()) },
      uLook: { value: Array.from({ length: MAX }, () => new THREE.Vector4(0.4, 0, 0, 0)) },
      uAlpha: { value: new Array<number>(MAX).fill(0) },
      uRotation: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
      uDrift: { value: new Array<number>(MAX).fill(0) },
      uAvoid: { value: new THREE.Vector3(0, 0, 0) },
      uBg: { value: new THREE.Vector3() },
      uTintCol: { value: new THREE.Vector3() },
      uTint: { value: 0 },
      uLight: { value: true },
      disableCenterDimming: { value: disableCenterDimming },
    }
    const shaderFor = (v: BackgroundVariant) => (v === 'metal' ? metalShader : fragmentShader)
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: shaderFor(variantRef.current),
      uniforms,
      depthTest: false,
      depthWrite: false,
    })
    swap.current = () => {
      material.fragmentShader = shaderFor(variantRef.current)
      material.needsUpdate = true
      dirty = true
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    scene.add(mesh)

    const texture = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false })
    const output = new THREE.ShaderMaterial({
      ...FXAAShader,
      uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
      depthTest: false,
      depthWrite: false,
    })
    output.uniforms.tDiffuse.value = texture.texture
    const screen = new THREE.Scene()
    screen.add(new THREE.Mesh(mesh.geometry, output))
    let quality = 1
    const resizeTexture = (w: number, h: number) => {
      const ratio = Math.min(window.devicePixelRatio * quality, Math.sqrt(2_073_600 / (w * h)))
      const width = Math.max(1, Math.floor(w * ratio))
      const height = Math.max(1, Math.floor(h * ratio))
      if (texture.width === width && texture.height === height) return
      texture.setSize(width, height)
      output.uniforms.resolution.value.set(1 / width, 1 / height)
    }

    const target = { bg: new THREE.Vector3(), tintCol: new THREE.Vector3(), tint: 0 }
    const readColors = () => {
      const root = document.documentElement
      const cs = getComputedStyle(root)

      const h = parseFloat(root.style.getPropertyValue('--accent-h') || cs.getPropertyValue('--accent-h')) || 0
      const parsedChroma = parseFloat(root.style.getPropertyValue('--accent-c') || cs.getPropertyValue('--accent-c'))
      const c = Number.isFinite(parsedChroma) ? parsedChroma : 1
      const dark = root.classList.contains('dark')
      uniforms.uLight.value = !dark
      target.tint = root.dataset.accent && root.dataset.accent !== 'neutral' ? 1 : 0
      if (target.tint) target.tintCol.copy(oklch(dark ? 0.72 : 0.62, (dark ? 0.14 : 0.16) * c, h))
      target.bg.copy(appBackground())
    }
    readColors()
    uniforms.uBg.value.copy(target.bg)
    uniforms.uTintCol.value.copy(target.tintCol)
    uniforms.uTint.value = target.tint

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    let dirty = true
    let boost = 0

    const mo = new MutationObserver(() => {
      readColors()
      dirty = true
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-accent'] })

    const size = () => {
      const { x: w, y: h } = uniforms.iResolution.value
      const mn = Math.min(w, h) || 1
      return { mn, W: w / mn, H: h / mn }
    }

    let band: [number, number] | null = null
    const readBand = (): [number, number] | null => {
      const el = document.querySelector('#main .note-prose')
      if (!el) return null
      const r = el.getBoundingClientRect()
      const box = container.getBoundingClientRect()
      return r.width ? [r.left - box.left, r.right - box.left] : null
    }

    let free: Spot[] = []
    let targets: Spot[] = []
    const rates = Array.from({ length: MAX }, () => rand(1.8, 3.6))
    const speeds = new Array<number>(MAX).fill(1)
    const relayout = (fresh: boolean) => {
      const { mn, W, H } = size()
      if (fresh || !free.length) {
        free = anchoredLayout(W, H)
        rates.forEach((_, i) => (rates[i] = rand(1.8, 3.6)))
      }
      if (avoidRef.current) band = readBand()

      const gap = 64 / mn
      targets = avoidRef.current ? noteLayout(free, W, band && [band[0] / mn, band[1] / mn], gap) : free
      dirty = true
    }
    const onShuffle = () => {
      boost = reduced ? 0 : 6
      if (reduced) uniforms.uSpots.value.forEach((sp) => (sp.w += 3 + Math.random() * 6))
      relayout(true)
    }
    window.addEventListener('lava:shuffle', onShuffle)

    kick.current = () => relayout(!avoidRef.current)

    const onResize = () => {
      const w = Math.max(container.clientWidth, 1)
      const h = Math.max(container.clientHeight, 1)
      const { W: oldW, H: oldH } = size()

      const ratio = Math.min(window.devicePixelRatio, Math.sqrt(2_073_600 / (w * h)))
      const bufferWidth = Math.floor(w * ratio)
      const bufferHeight = Math.floor(h * ratio)
      if (renderer.domElement.width !== bufferWidth || renderer.domElement.height !== bufferHeight) {
        renderer.setDrawingBufferSize(w, h, ratio)
      }
      resizeTexture(w, h)
      uniforms.iResolution.value.set(w, h)
      if (free.length) {
        const { W, H } = size()
        const sx = W / oldW
        const sy = H / oldH
        free = free.map((spot) => ({
          ...spot,
          x: spot.x * sx,
          y: spot.y * sy,
          ...(spot.dest && { dest: { ...spot.dest, x: spot.dest.x * sx, y: spot.dest.y * sy } }),
        }))
        uniforms.uSpots.value.forEach((spot) => {
          spot.x *= sx
          spot.y *= sy
        })
        relayout(false)
      }
      dirty = true
    }
    window.addEventListener('resize', onResize)
    const resize = new ResizeObserver(onResize)
    resize.observe(container)
    onResize()
    relayout(true)

    targets.forEach((t, i) => {
      const sp = uniforms.uSpots.value[i]
      sp.set(t.x, t.y, t.z, sp.w)
      uniforms.uLook.value[i].set(...t.look)
      uniforms.uAlpha.value[i] = t.a
      speeds[i] = t.speed
    })

    let previousTime: number | undefined
    let sampleTime = 0
    let sampleFrames = 0
    let fastSamples = 0
    let frame = 0
    renderer.setAnimationLoop((now) => {
      if (document.hidden) {
        previousTime = undefined
        sampleTime = sampleFrames = fastSamples = 0
        return
      }
      const elapsed = previousTime === undefined ? 0 : (now - previousTime) / 1000
      const dt = Math.min(elapsed, 0.1)
      previousTime = now
      if (!reduced && dt > 0) {
        sampleTime += dt
        sampleFrames++
        if (sampleTime >= 1) {
          const average = sampleTime / sampleFrames
          fastSamples = average < 0.018 ? fastSamples + 1 : 0
          const next = average > 0.022 ? Math.max(0.5, quality * 0.85) : fastSamples >= 3 ? Math.min(1, quality * 1.05) : quality
          if (Math.abs(next - quality) > 0.001) {
            quality = next
            resizeTexture(uniforms.iResolution.value.x, uniforms.iResolution.value.y)
            fastSamples = 0
          }
          sampleTime = sampleFrames = 0
        }
      }

      if (avoidRef.current && frame++ % 15 === 0) {
        const b = readBand()
        if (b && (!band || Math.abs(b[0] - band[0]) + Math.abs(b[1] - band[1]) > 4)) relayout(false)
      }
      const av = uniforms.uAvoid.value
      if (avoidRef.current && band) av.set(band[0], band[1], 1)
      else av.z = 0

      boost *= Math.exp(-dt * 3)
      if (!reduced) uniforms.iTime.value += dt * (1 + boost)
      let moving = false
      uniforms.uSpots.value.forEach((sp, i) => {
        const t = targets[i]
        if (!t) return
        const k = reduced ? 1 : 1 - Math.exp(-dt * rates[i])
        const a = uniforms.uAlpha.value[i]
        if (Math.abs(sp.x - t.x) + Math.abs(sp.y - t.y) + Math.abs(sp.z - t.z) + Math.abs(a - t.a) > 0.0005) moving = true

        if (a < 0.01 && t.a > 0) {
          sp.set(t.x, t.y, t.z, sp.w)
          uniforms.uLook.value[i].set(...t.look)
          speeds[i] = t.speed
        } else if (t.a > 0) {
          sp.x += (t.x - sp.x) * k
          sp.y += (t.y - sp.y) * k
          sp.z += (t.z - sp.z) * k
          const lk = uniforms.uLook.value[i]
          lk.x += (t.look[0] - lk.x) * k
          speeds[i] += (t.speed - speeds[i]) * k
        }
        uniforms.uAlpha.value[i] = a + (t.a - a) * k

        if (!reduced) sp.w += dt * speeds[i] * (1 + boost)
        if (variantRef.current === 'nebula' && uniforms.uAlpha.value[i] > 0.01) {
          uniforms.uRotation.value[i].set(Math.cos(sp.w * 0.4), Math.sin(sp.w * 0.4), Math.cos(sp.w * 0.3), Math.sin(sp.w * 0.3))
          uniforms.uDrift.value[i] = Math.sin(sp.w * 0.7) * 0.3
        } else if (variantRef.current === 'metal' && uniforms.uAlpha.value[i] > 0.01) {
          uniforms.uMetalSpots.value[i].set(
            sp.x + 0.016 * Math.sin(sp.w * 0.55 + i * 1.3),
            sp.y + 0.016 * Math.cos(sp.w * 0.42 + i * 2.1),
            (0.24 / sp.z) * (1 + 0.035 * Math.sin(sp.w * 0.8 + i)),
          )
        }
      })

      const ck = reduced ? 1 : 1 - Math.exp(-dt * 4)
      uniforms.uBg.value.lerp(target.bg, ck)
      uniforms.uTintCol.value.lerp(target.tintCol, ck)
      uniforms.uTint.value += (target.tint - uniforms.uTint.value) * ck
      const coloring =
        uniforms.uBg.value.distanceTo(target.bg) +
          uniforms.uTintCol.value.distanceTo(target.tintCol) +
          Math.abs(uniforms.uTint.value - target.tint) >
        0.002

      if (!reduced || boost > 0.01 || moving || coloring || dirty) {
        renderer.setRenderTarget(texture)
        renderer.render(scene, camera)
        renderer.setRenderTarget(null)
        renderer.render(screen, camera)
        dirty = false
      }
    })

    return () => {
      swap.current = () => {}
      window.removeEventListener('resize', onResize)
      resize.disconnect()
      window.removeEventListener('lava:shuffle', onShuffle)
      mo.disconnect()
      renderer.setAnimationLoop(null)
      container.removeChild(renderer.domElement)
      material.dispose()
      texture.dispose()
      output.dispose()
      mesh.geometry.dispose()
      renderer.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className={`absolute inset-0 ${className}`} aria-hidden />
}

export default InteractiveNebulaShader
