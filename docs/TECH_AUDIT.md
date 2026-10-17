# TYPOS: технический и визуальный аудит

Справочник по стеку и графике проекта TYPOS (учебные конспекты, PWA). Цель документа: по нему можно воспроизвести стекло, туманности, линзу, палитру и типографику в любом другом месте, например в одиночном HTML-файле.

**Как пользоваться.** Если нужно «такое же стекло» или «такую же туманность» в новом HTML, бери раздел 12 и готовый пример `docs/examples/glass-nebula.html`: там всё на чистом HTML, CSS и JS, без сборки. Остальные разделы объясняют, откуда взяты числа и как это устроено в приложении.

---

## 1. Стек

| Слой | Технология | Версия | Зачем |
| --- | --- | --- | --- |
| Сборка | Vite | 8.3 | дев-сервер, сборка, ленивые чанки |
| UI | React | 19.3 | интерфейс |
| Язык | TypeScript | 6.0, strict, `erasableSyntaxOnly` | типы |
| Стили | Tailwind CSS | 4.3 (`@theme inline`, `@custom-variant dark`) | утилиты поверх CSS-токенов |
| Компоненты | shadcn/ui + Radix (`radix-ui` 1.7) | — | диалоги, меню, сайдбар, вкладки |
| Иконки | lucide-react | 1.54 | одна толщина линии, без эмодзи |
| Анимации | Motion (`motion/react`) | 14.0 | пружины, `layout`, появление списков |
| Маршруты | React Router | 7.18 (data router, `lazy`, `viewTransition`) | URL вида `/s/:subject/n/:note` |
| Состояние | Zustand | 5 (persist для темы, шрифта, фона) | хранилище |
| Редактор | Tiptap | 3.31 (StarterKit, TableKit, Mathematics, Markdown, Highlight, List, Image, CodeBlock) | текст конспектов |
| Формулы | KaTeX | 0.18 | рендер `$…$` и `$$…$$` |
| Ввод формул | MathLive | 0.111 (лениво) | визуальный редактор формулы |
| Схемы | Mermaid | 12.1 (лениво) | блоки ```` ```mermaid ```` |
| Поиск | MiniSearch | 7.2 | `Ctrl K`, е = ё |
| 3D/шейдеры | three.js | 0.186 (отдельный чанк) | фон: туманности и металл |
| Хранение | File System Access API + IndexedDB (`idb-keyval`) | — | папка на диске или браузер |
| PWA | vite-plugin-pwa (Workbox) | 2.0 | офлайн, установка |
| Шрифты | Fontsource (self-host) | — | без Google CDN |
| Тесты | Vitest + jsdom | 5.0 | логика, Markdown, импорт |
| Картинки при сборке | sharp | 0.35 | иконки PWA из SVG |
| Сервер импорта | `@modelcontextprotocol/sdk` + zod, запуск через tsx | 1.32 | запись конспектов в папку извне |

Браузер: стекло-линза работает только в Chromium (Chrome, Edge). В остальных браузерах автоматически используется обычное матовое стекло.

---

## 2. Где что лежит

| Файл | Что внутри |
| --- | --- |
| `src/styles/tokens.css` | все цвета, радиусы, тени, длительности; светлая и тёмная темы; нейтральный акцент |
| `src/index.css` | шрифты в `@theme`, классы стекла (`.liquid*`, `.glass`), линза (`.liquid-lens`), типографика конспекта, стили редактора и схем, View Transitions |
| `src/components/ui/liquid-lens.tsx` | линза Liquid Glass: карта смещения, маска углов, SVG-фильтр, блик за курсором |
| `src/components/ui/liquid-shader.tsx` | фон: шейдер туманностей и металлических пузырей, раскладка пятен, анимация |
| `src/components/ui/liquid-glass-button.tsx` | кнопка LiquidButton (21st.dev) и её SVG-фильтр `#container-glass` |
| `src/app/accent.ts`, `src/lib/subjectPalette.ts` | акцент: нейтральный или цвет предмета (OKLCH) |
| `src/app/theme.ts` | класс `.dark` на `<html>`, `color-scheme` |
| `src/lib/motion.ts` | общие пружины и кривые для Motion |
| `src/editor/diagrams.ts` | Mermaid: тема, раскладка, щелчок для правки |
| `src/components/TyposMark.tsx`, `scripts/gen-icons.mjs` | знак TYPOS и иконки приложения из одной геометрии |
| `docs/examples/glass-nebula.html` | рабочий одиночный пример стекла, линзы и туманностей |

---

## 3. Цвета и токены

Нейтрали «тёплый графит». Светлая и тёмная темы спроектированы парами, не инверсией. Тёмная тема включается классом `.dark` на `<html>`.

### 3.1 Поверхности

| Токен | Светлая | Тёмная | Где |
| --- | --- | --- | --- |
| `--app-bg` | `#f3f2ed` | `#191918` | фон страницы под стеклом |
| `--background` | `#faf9f6` | `#1f1f1d` | бумага редактора |
| `--foreground` | `#1f1e1d` | `#f2f1ec` | текст (контраст 15:1) |
| `--card` | `#ffffff` | `#2a2a28` | карточки, блоки формул и схем |
| `--muted` | `#efeee9` | `#2f2f2c` | фон кода, вторичные плашки |
| `--muted-foreground` | `#6b6a64` | `#a6a39a` | вторичный текст (на стекле: `#2c2b28` / `#b8b5ac`) |
| `--border` | `rgb(31 30 29 / .1)` | `rgb(245 244 238 / .09)` | линии |
| `--destructive` | `#c4382b` | `#ff7b6e` | ошибки |

### 3.2 Стекло

| Токен | Светлая | Тёмная |
| --- | --- | --- |
| `--sidebar` (заливка стекла 1-го слоя) | `rgb(255 255 255 / .24)` | `rgb(30 30 28 / .5)` |
| `--sidebar-accent` (выбранная строка) | `rgb(255 255 255 / .45)` | `rgb(255 255 255 / .08)` |
| `--list` (колонка списка) | `rgb(255 255 255 / .22)` | `rgb(30 30 28 / .3)` |
| `--column-blur` | `12px` | `12px` |
| `--glass-sat` | `150%` | `150%` |
| `--sheen` (сила белой кромки) | `.35` | `.05` |
| `--glass-blur` / `--glass-mix` (класс `.glass`) | `24px` / `48%` | `24px` / `55%` |

### 3.3 Акцент

Один оттенок на всё приложение задаётся двумя числами на `<html>`: `--accent-h` (hue OKLCH) и `--accent-c` (множитель насыщенности). Светлота зафиксирована, поэтому контраст держится при любом цвете.

```css
--primary:   oklch(0.5  calc(0.17 * var(--accent-c)) var(--accent-h));   /* кнопки, ~6:1 с белым */
--highlight: oklch(0.56 calc(0.18 * var(--accent-c)) var(--accent-h));   /* иконки, фокус */
--accent:    oklch(0.6  calc(0.17 * var(--accent-c)) var(--accent-h) / 0.1);  /* hover */
--selection: oklch(0.62 calc(0.17 * var(--accent-c)) var(--accent-h) / 0.22);
/* тёмная тема */
--primary:   oklch(0.74 calc(0.14 * var(--accent-c)) var(--accent-h));
```

- **На общих экранах** `data-accent="neutral"`: акцент графитовый в светлой теме (`--primary: #1f1e1d`) и белый в тёмной (`#f5f4f0`).
- **Внутри предмета** `data-accent` равен его цвету. `--accent-h` и `--accent-c` берутся из палитры ниже, и фон-туманность тонируется этим цветом.
- **Переход между оттенками** плавный: `@property --accent-h { syntax: '<number>' }`, на время смены вешается `html.accent-anim { transition: --accent-h .9s cubic-bezier(.22,1,.36,1) }`. Оттенок идёт по кратчайшему пути по кругу.

Цвета предметов (hue / chroma-множитель): red 27/1, orange 50/1, amber 75/.9, lime 130/.95, green 150/1, teal 185/.75, sky 230/.85, blue 262/1, indigo 280/1, violet 295/1, fuchsia 325/1, pink 350/1, rose 10/1, brown 55/.4, slate 255/.18. Плашки предметов в светлой теме `oklch(0.5–0.66 …)`, в тёмной `oklch(0.7–0.84 …)` (см. `--subject-*` в `tokens.css`).

Палитра текста и маркера в конспектах повторяет Notion: `--tc-*` и `--hl-*` (например, `--tc-blue: #337ea9`, `--hl-blue: #e7f3f8`).

### 3.4 Форма, тени, движение

```css
--radius: 0.75rem;          /* контрол 12 px */
--radius-surface: 1.5rem;   /* поверхность 24 → блок 16 → контрол 12 → чип 8 */
--radius-block: 1rem;
--radius-chip: 0.5rem;
--shadow-card:  0 1px 2px rgb(31 30 29 / .04), 0 4px 14px rgb(31 30 29 / .05);
--shadow-float: 0 10px 30px var(--glass-shadow), 0 2px 6px rgb(31 30 29 / .06);
--dur-fast: 150ms; --dur-base: 200ms; --dur-slow: 300ms;     /* выход ≈ 65 % входа */
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);
--ease-in:  cubic-bezier(0.55, 0, 1, 0.45);
```

Motion: `spring = { type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }`, мягкая `{ stiffness: 260, damping: 28 }`. Появление списков идёт со сдвигом `staggerChildren: 0.035`, элемент проявляется с `opacity 0 → 1` и `y 4 → 0` за 200 мс. Анимируются только `transform` и `opacity`, при `prefers-reduced-motion` длительности становятся 0.

---

## 4. Типографика

| Роль | Шрифт | Пакет |
| --- | --- | --- |
| Интерфейс и текст | Inter Variable (`font-feature-settings: "cv11", "ss01"`) | `@fontsource-variable/inter` |
| Альтернатива для текста | Golos Text Variable | `@fontsource-variable/golos-text` |
| Режим чтения | PT Serif 400/700 | `@fontsource/pt-serif` |
| Код | JetBrains Mono Variable | `@fontsource-variable/jetbrains-mono` |
| Логотип TYPOS | Unbounded Variable, 600, разрядка `0.06em` | `@fontsource-variable/unbounded` |

Конспект: 17 px, межстрочный 1.6, ширина 68ch. Шкала размеров 13 · 15 · 17 · 20 · 24 · 32. Заголовки 600–700, текст 400.

---

## 5. Раскладка

Три колонки, как у Apple Notes:
1. **Сайдбар:** 16rem (256 px), стекло 1-го слоя `.liquid-column`.
2. **Колонка списка:** 300 px, `.liquid-column-soft`.
3. **Основная область:** редактор (до 68ch по центру) или страница предмета.

Фон-туманность лежит за всем интерфейсом (`position: fixed; inset: 0; z-index: -1`). Без неё стеклу нечего размывать, и оно выглядит как белая панель.

Справа над редактором висит вертикальная капсула форматирования, сверху справа капсула кнопок. Обе сделаны линзой.

Переходы между экранами идут через View Transitions API. Имя `view-transition-name: main` выдаётся только на время перехода (`:root:active-view-transition #main`), объяснение в 6.5.

---

## 6. Стекло

### 6.1 Правило слоёв

- **1-й слой** лежит прямо на фоне: сайдбар, правая капсула, кнопки сверху, карточки на главной. Это прозрачное стекло: заливка `--sidebar`, `blur(12px) saturate(150%)`, тонкая белая кромка.
- **2-й слой** лежит на другом стекле: поиск в сайдбаре, переключатели вкладок. Он плотнее (`--sidebar` + 14 % `--card`) и размывает сильнее (`blur(18px)`).
- **Свой эффект** для отдельных элементов не изобретается: всё стекло собирается из этих классов.

### 6.2 Классы

```css
:root { --liquid-edge: inset 0 0 0 1px rgb(255 255 255 / calc(var(--sheen) * 1.6)); }

/* колонки */
.liquid-column {
  background: var(--sidebar);
  backdrop-filter: blur(var(--column-blur)) saturate(var(--glass-sat));
  box-shadow: inset -1px 0 0 rgb(255 255 255 / calc(var(--sheen) * 1.6)),
              inset 1px 1px 0 rgb(255 255 255 / calc(var(--sheen) * 1.2));
}
.liquid-column-soft {
  background: var(--list);
  backdrop-filter: blur(var(--column-blur)) saturate(var(--glass-sat));
  box-shadow: inset -1px 0 0 rgb(255 255 255 / calc(var(--sheen) * 1.4));
}

/* плавающее стекло 1-го и 2-го слоя */
.liquid, .liquid-2 {
  position: relative;
  box-shadow: var(--liquid-edge);
  backdrop-filter: blur(var(--column-blur)) saturate(var(--glass-sat));
}
.liquid { background: transparent; }
.liquid.liquid-menu { background: var(--sidebar); }          /* меню поверх текста */
.liquid.liquid-lava { background: var(--sidebar); }          /* = стекло колонки; запасной вид линзы */
.liquid-2 {
  background: color-mix(in srgb, var(--sidebar), var(--card) 14%);
  backdrop-filter: blur(calc(var(--column-blur) * 1.5)) saturate(var(--glass-sat));
}
.liquid-active { background: var(--sidebar-accent); box-shadow: var(--liquid-edge); color: var(--highlight); }

/* стеклянная полоса сверху над прокруткой */
.glass-bar {
  background: color-mix(in srgb, var(--background) 55%, transparent);
  backdrop-filter: blur(20px) saturate(160%);
  border-bottom: 0.5px solid var(--border);
}
```

Класс `.glass` используется для модальных окон и экрана выбора папки. Он матовый: блик сверху `linear-gradient(180deg, rgb(255 255 255 / var(--sheen)) 0, transparent 42px)`, заливка `color-mix(--card 48%)`, `blur(24px) saturate(150%)`, рамка `0.5px` и зерно. Зерно накладывается через `::after`: SVG `feTurbulence baseFrequency=.85 numOctaves=2` с `opacity .05` и `mix-blend-mode: overlay`.

Доступность:
- при `prefers-reduced-transparency` стекло становится сплошным `--card` без размытия;
- при `prefers-contrast: more` вместо белой кромки рисуется рамка `--border`.

### 6.3 Линза Liquid Glass

Сделана по описанию Apple (WWDC25 «Meet Liquid Glass»). Это не размытие, а линза:
1. **Преломление.** Фон изгибается у краёв, в центре почти не тронут. Карта смещения считается под форму элемента (скруглённый прямоугольник), а не берётся из шума.
2. **Дисперсия.** Каналы R, G и B смещаются с разной силой (±8–9 %), поэтому у кромки появляется радужная кайма.
3. **Материализация.** Линза появляется нарастанием силы преломления на пружине (`stiffness 220, damping 26`), а не только прозрачностью.
4. **Свет.** Блик по кромке следует за курсором. При нажатии стекло «наполняется светом» от точки касания: круг 90 px с `radial-gradient(white .45 → 0)` растёт с 0.2 до 2.4 и гаснет за 0.7 с.

Алгоритм:
- **Карта смещения (canvas размером с элемент).** Для каждого пикселя считается SDF скруглённого прямоугольника и нормаль к ближайшему краю. В полосе `bezel` у кромки сила растёт по smoothstep. R = `128 − nx·m·127`, G = `128 − ny·m·127`, где 128 значит «на месте».
- **SVG-фильтр** (`filterUnits="userSpaceOnUse"`, размер элемента):
  1. `feImage` с картой, затем `feGaussianBlur stdDeviation=frost`;
  2. три `feDisplacementMap` с `scale = refraction·2·(1 + (k−1)·dispersion)`, по одному на канал;
  3. `feColorMatrix` оставляет из каждого результата свой канал;
  4. два `feComposite arithmetic k2=1 k3=1` складывают каналы обратно;
  5. `feColorMatrix saturate 1.35` делает цвета под стеклом живее, как у Apple.
- **Подключение:** `backdrop-filter: url(#lens-id)` на самом элементе.
- **Постоянная призма** (`::after`): белая кромка 1 px только на скруглениях, по маске «близость к углам». Это canvas с гауссом от середины каждой дуги, `σ = max(0.75·r, 8)`. Прозрачность `--prism-corner-alpha` (.32 / .36).
- **Блик под курсором** (`::before`, `data-lit`): кромка 1.5 px, в центре пятна белая, по краям раскладывается в спектр `repeating-conic-gradient` из 8 цветов (`#ff6b6b #ffb347 #fff176 #7ee8a2 #5ad1ff #7d8bff #d07bff`). Радиус пятна `--prism-r = min(130px, 0.3·max(w, h))`, прозрачность `--prism-alpha` (.64 / .72). В тёмной теме `mix-blend-mode: plus-lighter`.

Тон и тень линзы:

```css
:root { --lens-tint: rgb(255 255 255 / .16);
        --lens-shadow: 0 10px 28px rgb(0 0 0 / .1), 0 1px 3px rgb(0 0 0 / .06), inset 0 0 0 .5px rgb(0 0 0 / .07); }
.dark { --lens-tint: rgb(255 255 255 / .035);
        --lens-shadow: 0 12px 32px rgb(0 0 0 / .38), 0 1px 3px rgb(0 0 0 / .3), inset 0 0 0 .5px rgb(255 255 255 / .1); }
.liquid-lens-menu { --lens-tint: rgb(255 255 255 / .38); }   .dark .liquid-lens-menu { --lens-tint: rgb(24 24 22 / .4); }
.liquid-lens-card { --lens-tint: var(--sidebar); }
```

Пресеты в приложении:

| Где | bezel | refraction | dispersion | frost | вид |
| --- | --- | --- | --- | --- | --- |
| Правая капсула форматирования | 14 | 16 | .09 | 1 | bar |
| Кнопки сверху | 12 | 12 | .09 | 1 | bar |
| Меню над выделенным текстом, меню таблицы | 14 | 12 | .09 | 5 | menu |
| Док тулз | 16 | 16 | .09 | 1 | bar |
| Карточки на главной и на странице предмета | 22 | 22 | .08 | 4 | card |

Если линза не поддерживается, ставится класс `liquid liquid-lava`, то есть стекло колонки.

### 6.4 LiquidButton (21st.dev)

Крупная кнопка «Новый предмет» и «Выбрать папку». Это капсула с многослойной `box-shadow`, внутренние тени дают объём кромки. Внутри лежит слой с `backdrop-filter: url(#container-glass)`:

```html
<filter id="container-glass" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="1" seed="1" result="turbulence"/>
  <feGaussianBlur in="turbulence" stdDeviation="2" result="blurredNoise"/>
  <feDisplacementMap in="SourceGraphic" in2="blurredNoise" scale="70" xChannelSelector="R" yChannelSelector="B" result="displaced"/>
  <feGaussianBlur in="displaced" stdDeviation="4" result="finalBlur"/>
  <feComposite in="finalBlur" in2="finalBlur" operator="over"/>
</filter>
```

Тени светлой темы: `0 0 6px rgba(0,0,0,.03), 0 2px 6px rgba(0,0,0,.08), inset 3px 3px .5px -3px rgba(0,0,0,.9), inset -3px -3px .5px -3px rgba(0,0,0,.85), inset 1px 1px 1px -.5px rgba(0,0,0,.6), inset -1px -1px 1px -.5px rgba(0,0,0,.6), inset 0 0 6px 6px rgba(0,0,0,.12), inset 0 0 2px 2px rgba(0,0,0,.06), 0 0 12px rgba(255,255,255,.15)`. В тёмной теме те же тени, только инвертированы в белые.

### 6.5 Подводные камни

1. **Backdrop root.** Стекло размывает только то, что нарисовано до ближайшего backdrop root. Его создают предки с `filter`, `opacity < 1`, `mask`, `clip-path`, `mix-blend-mode`, `backdrop-filter` и `view-transition-name`. Из-за этого `view-transition-name` у `#main` выдаётся только на время перехода, иначе стекло внутри ничего не размывает.
2. **Размытие на `::before`.** С псевдоэлементом Chrome не видит, что под панелью, и стекло только тонирует. Размытие должно стоять на самом элементе.
3. **`backdrop-filter: url()`.** Работает только в Chromium. Firefox и Safari такое значение принимают, но ничего не рисуют, поэтому браузер определяется по user agent.
4. **Без фона стекло не видно.** На ровном фоне стекло выглядит как белая панель. Под ним всегда должны быть туманности или контент.

---

## 7. Фон: туманности

Источник: шейдер `InteractiveNebulaShader` с 21st.dev (автор Dhileep Kumar GM). Он переделан в прозрачное «жидкое стекло», на экране может быть несколько пятен.

### 7.1 Как устроено

- **Рендер.** three.js: `OrthographicCamera(-1, 1, 1, -1)` и `PlaneGeometry(2, 2)` с `ShaderMaterial` во весь экран. Рисуется в половинном разрешении (`setPixelRatio(min(dpr, 2) · 0.5)`), `antialias: false`, `powerPreference: 'low-power'`. Пиксели вне пятна не считаются. Модуль грузится отдельным чанком.
- **Пятна.** До 10 штук, данные идут в шейдер массивами:
  - `uSpots[i] = (x, y, scale, time)`: координаты в долях `min(w, h)`, `y` снизу вверх; масштаб `z` (больше значит меньше, радиус ≈ 0.62/z);
  - `uLook[i] = (тёмная середина 0.36–0.44, сдвиг шума 0–1, поворот 0–2π, зеркальность ±1)`;
  - `uAlpha[i]` от 0 до 1, проявленность.
- **Форма.** Ray-march из исходного шейдера, 6 шагов. Получается круглая туманность с притемнённой серединой (кольцо): `v *= mix(0.3, 1, smoothstep(0.6·hole, hole, dn))`. Узор у каждого пятна свой: поворот, зеркало и сдвиг шума задаются через `uLook`. Форма из оригинала намеренно не менялась.
- **Вид «прозрачное стекло».**
  - Светлая тема: лёгкая тень тела `bg·(1 − .12·body)`, кромка темнее (`edge·.32`).
  - Тёмная тема: почти прозрачное тело `+.07·body`, белые блики на плотных местах `+.55·glint`, тонкая кромка.
  - Радуга занимает ~4 % на кромке: `mix(white, palette, 0.04)`.
- **Тонировка.** Внутри предмета стекло подкрашивается цветом предмета (`uTint`, `uTintCol` из OKLCH: L .62 / .72, C .16 / .14 · chroma). Переход цвета плавный, `lerp` с `1 − e^(−4·dt)`.

### 7.2 Раскладка пятен

- **Общий фон.**
  - Два якоря: левый верхний угол `(0.08, H − 0.08)` и правый нижний `(W − 0.08, 0.08)`.
  - У каждого якоря одно большое пятно (смещение до 0.12, масштаб 0.8–1.2) и от 0 до 3 мелких (расстояние 0.25–0.7, масштаб 1.6–3.6). Угол выбирается «внутрь» экрана.
  - Посередине от 0 до 4 случайных пятен (масштаб 1.4–3.2).
- **Открыт конспект** (`avoidText`).
  - Средние пятна уезжают к ближайшему якорю, на заранее выбранное место `dest` (масштаб 2.2–3.6). Место выбирается заранее, чтобы при пересчётах ничего не дёргалось.
  - Под колонкой текста `.note-prose` шейдер гасит фон с мягким краем 56 px (`uAvoid`).
  - Пятна у колонки ужимаются, чтобы целиком влезть в свободную полосу сбоку, и не обрезаются.
- **Движение.**
  - У каждого пятна своё время `w`, оно копится в JS: `w += dt · speed`, скорость 0.8–1.2. Если умножать на скорость общее время, смена скорости дёргает узор.
  - К новому месту пятно «доезжает» по закону `1 − e^(−dt·rate)`, rate 1.8–3.6 у каждого своё.
  - Клик по логотипу (событие `lava:shuffle`) делает новый расклад и короткий разгон времени (`boost = 6`, затухает как `e^(−3t)`).
- **Сокращение движения.** При `prefers-reduced-motion` время стоит, кадр перерисовывается только при изменениях.

### 7.3 Шейдер туманностей (полностью)

```glsl
#define MAX 10
uniform vec2 iResolution;
uniform vec4 uSpots[MAX];   // xy — центр в долях min(w,h), z — масштаб, w — время пятна
uniform vec4 uLook[MAX];    // x — тёмная середина, y — сдвиг шума и оттенка, z — поворот, w — зеркальность ±1
uniform float uAlpha[MAX];  // проявленность
uniform vec3 uAvoid;        // x0, x1 — колонка текста в px, z — 1 = гасить фон под ней
uniform vec3 uBg;           // фон страницы
uniform vec3 uTintCol;      // цвет предмета
uniform float uTint;        // 0 — чистое стекло, 1 — тонированное
uniform bool uLight;
uniform bool disableCenterDimming;
varying vec2 vUv;

mat2 m(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float map(vec3 p, float t, float seed) {
  p.xz *= m(t * 0.4);
  p.xy *= m(t * 0.3);
  vec3 q = p * 2. + t + seed;
  // качание втрое меньше оригинала: иначе туманность съезжает к краю пятна
  return length(p + vec3(sin(t * 0.7)) * 0.3) * log(length(p) + 1.0)
       + sin(q.x + sin(q.z + sin(q.y))) * 0.5 - 1.0;
}
float nebula(vec2 uv, float t, float seed) {
  float col = 0.0;
  float d = 2.5;
  for (int i = 0; i <= 5; i++) {
    vec3 p = vec3(0, 0, 5.) + normalize(vec3(uv, -1.)) * d;
    float rz = map(p, t, seed);
    float f = clamp((rz - map(p + 0.1, t, seed)) * 0.5, -0.1, 1.0);
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
  float body = 0.0, glint = 0.0, edge = 0.0;
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
      float v = nebula(ruv, sp.w, lk.y * 6.28318);
      if (!disableCenterDimming) v *= mix(0.3, 1.0, smoothstep(lk.x * 0.6, lk.x, dn));
      float w = smoothstep(1.0, 0.5, dn) * a;
      float e = smoothstep(0.16, 0.28, v) * (1.0 - smoothstep(0.3, 0.46, v));
      vec3 prism = mix(vec3(1.0), 0.5 + 0.5 * cos(6.28318 * (v * 0.8 + lk.y + vec3(0.0, 0.33, 0.67))), 0.04);
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
```

Вершинный шейдер: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`.

### 7.4 Второй вариант: металлические пузыри

Переключается в сайдбаре («Фон: металл»). Пятна те же, но рисуются как метаболы и сливаются при сближении.
- **Поле.** `F = Σ a·r²/|p−c|²`, внутри там, где `F > 1`. Край сглаживается по градиенту поля (≈1.5 px).
- **Высота и нормаль.** Высота `h = √(1 − 1/F)`, нормаль берётся по градиенту, как у сферы.
- **Хром.** Отражение «студии»: полосы `cos` вдоль диагонали, изогнутые нормалью, медленно текут.
- **Блики и кромка.** Каналы раскладываются у кромки (`shift = .006 + .03·(1−h)²`), френель `(1 − n.z)²·.35`, блик `pow(·, 36)·.55` от света сверху слева, мягкая тень сдвинутым полем.
- **Тонировка.** Внутри предмета металл тонируется его цветом.

Референс: Paper Shaders «Liquid Metal», 21st.dev «liquid-metal-hero». Код свой, полный шейдер в `liquid-shader.tsx` (`metalShader`).

---

## 8. Схемы (Mermaid)

Блок ```` ```mermaid ```` рисуется карточкой, как блок формулы. Щелчок по схеме открывает её код, курсор ушёл, и код свернулся. Библиотека грузится, только когда в заметке есть схема.

```js
mermaid.initialize({
  startOnLoad: false, securityLevel: 'strict', theme: 'base', look: 'classic',
  layout: 'dagre',   // в Mermaid 12 по умолчанию стрелки под прямым углом; dagre даёт плавные кривые
  fontFamily: getComputedStyle(document.body).fontFamily,
  flowchart: { curve: 'basis', padding: 14, nodeSpacing: 28, rankSpacing: 40, useMaxWidth: false, wrappingWidth: 220 },
  themeCSS: `.node rect { rx: 10px; ry: 10px; } .node, .node * { filter: none !important; }
             .node rect, .node polygon, .node circle, .node path { stroke-width: 1px; }
             .flowchart-link { stroke-width: 1.2px; } .nodeLabel { line-height: 1.45; font-weight: 400; }`,
  themeVariables: {
    // светлая: primaryColor '#ffffff', primaryTextColor '#1f1e1d', primaryBorderColor '#d6d3cb', lineColor '#9b988f'
    // тёмная:  primaryColor '#1c1c1d', primaryTextColor '#f2f2f0', primaryBorderColor '#3d3d3f', lineColor '#8a8a88'
    darkMode, background: 'transparent', fontSize: '15px',
  },
})
```

Вид: скруглённые узлы 10 px, тонкая рамка, без тени, текст 15 px обычной толщины, серые плавные стрелки. Если схема шире колонки, она ужимается, но не мельче 80 %, дальше включается горизонтальная прокрутка.

---

## 9. Бренд

### 9.1 Знак

Шестиугольник в шестиугольнике со стеклянными гранями, как стеклянная призма сверху. Референс: собственное видео GIGANIT.

```js
const hex = (r, c = 32) => Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 3) * i - Math.PI / 2          // вершина сверху
  return [c + r * Math.cos(a), c + r * Math.sin(a)]
})
// сетка 64: внешний R = 26 (в иконке 22), внутренний = 0.42·R
// 6 граней — четырёхугольники между внешним и внутренним; прозрачность граней (по часовой от верхней правой):
const FACE_ALPHA = [0.16, 0.08, 0.05, 0.07, 0.12, 0.22]   // свет сверху слева; в иконке ×1.8 («молочнее»)
```

- **В интерфейсе** знак рисуется контуром `currentColor` в 1.5 px (`vector-effect: non-scaling-stroke`). Грани `currentColor` с этими прозрачностями, центр закрашен `var(--primary)`: внутри предмета это цвет предмета.
- **Иконка приложения** (64 × 64, скругление 15):
  - фон `#0b0d10`;
  - бирюзовое свечение `radial-gradient #16b3ad` (центр 26 %/68 %, радиус 55 %, прозрачность .9 → 0);
  - тёплое свечение `#ff8a3d` (72 %/24 %, 50 %, .95 → 0);
  - грани белые, линии `rgba(255,255,255,.92)` толщиной R/34 (для favicon 2.4);
  - центр `linear-gradient(135°, #6f9cf2 → #3d63c8)`.
- **Генерация.** Всё делает `npm run icons` (`scripts/gen-icons.mjs`, sharp): favicon, `public/brand/typos-icon.svg`, `typos-mark.svg`, PNG 192/512, maskable и apple-touch.

### 9.2 Слово и обложка

- **Слово TYPOS:** Unbounded 600, разрядка 0.06em.
- **Обложка README** (`docs/cover.jpg`, 1280 × 640):
  - фон `#08090c`;
  - свечения: бирюзовое радиусом 420 px и оранжевое радиусом 340 px;
  - знак R = 150;
  - TYPOS шрифтом Unbounded 500 с разрядкой 0.12em;
  - тонкая линия `rgba(255,255,255,.28)`;
  - подпись STUDY NOTES шрифтом Unbounded 400 с разрядкой 0.5em и прозрачностью .62;
  - зерно `feTurbulence 0.9` с прозрачностью .09.

  Текст переведён в кривые через fontkit.

---

## 10. Редактор и формат (техническая часть)

- **Расширения Tiptap 3:**
  - StarterKit (заголовки h1–h3, ссылки);
  - TaskList и TaskItem;
  - TableKit (обёртка с прокруткой, `cellMinWidth 80`);
  - Image (путь внутри папки → objectURL);
  - InlineMath и BlockMath (KaTeX);
  - свой DollarMath: `$…$` превращается в формулу прямо при наборе и вставке;
  - Highlight с цветами (`==…==` и `<mark data-color>`), цвет текста (`<span data-text-color>`);
  - CodeBlock со схемами;
  - `@tiptap/markdown`.
- **Хранение.** Конспект хранится в Markdown с frontmatter (`id`, `created`, `updated`). Первая строка `# Заголовок`, по ней называется файл. Формулы пишутся только как `$…$` и `$$…$$`, таблицы в формате GFM.
- **Вставка формул.** Формулы из блоков кода ```` ```latex ````, из `\( \)` и `\[ \]`, из отрендеренного KaTeX или MathJax (`<annotation encoding="application/x-tex">`) превращаются в настоящие формулы (`src/editor/texImport.ts`).
- **Хранилище.** Это папка с подпапками предметов: `Конспекты/`, `Закреп/` (карточки с одной формулой), `Инструменты/` (HTML в sandbox iframe без `allow-same-origin`, CSP разрешает скрипты только с cdnjs, jsdelivr и unpkg), `_subject.json`, корзина `.studynotes/trash`.
- **Синхронизация с диском.** Открытый конспект сверяется с файлом на диске перед сохранением. Если файл поменяли снаружи, приложение подгружает новую версию, а если есть несохранённые правки, спрашивает, какую оставить.

---

## 11. Референсы и документация

### Дизайн
- Apple, WWDC25 «Meet Liquid Glass»: https://developer.apple.com/videos/play/wwdc2025/219/
- Apple HIG, Materials: https://developer.apple.com/design/human-interface-guidelines/materials
- Apple Notes: раскладка в три колонки, заголовок первой строкой.
- Notion: меню над выделенным текстом, палитра цветов текста и маркера.
- Свои проекты LM_SERVER (матовое стекло) и Jobmatcher (зелёный акцент, лестница скруглений 24 → 16 → 12 → 8).
- Видео GIGANIT (своё): знак и обложка.

### Компоненты 21st.dev
- Фон-туманность: https://21st.dev/@dhileepkumargm/components/liquid-shader
- Металл (референс): https://21st.dev/chowlol202/liquid-metal-hero/default, https://21st.dev/@paper-design/components/liquid-metal
- Кнопка Liquid Glass Button (LiquidButton, `#container-glass`): https://21st.dev/community/components/explore/liquid-glass-button
- Панель редактора: https://21st.dev/@uvain/components/rich-text-editor-toolbar
- Палитра `Ctrl K`: https://21st.dev/@ddoemonn/components/command-palette
- Дерево предметов: https://21st.dev/@nikolas-sapa/components/tree-root-trace
- Док тулз: https://21st.dev/@ssicevs/components/macos-dock, https://21st.dev/@soralabs/components/dock-nav

### Документация
- `backdrop-filter`: https://developer.mozilla.org/docs/Web/CSS/backdrop-filter
- `feDisplacementMap`: https://developer.mozilla.org/docs/Web/SVG/Element/feDisplacementMap
- `@property`: https://developer.mozilla.org/docs/Web/CSS/@property
- OKLCH: https://developer.mozilla.org/docs/Web/CSS/color_value/oklch
- View Transitions: https://developer.mozilla.org/docs/Web/API/View_Transition_API
- File System Access: https://developer.mozilla.org/docs/Web/API/File_System_API
- three.js ShaderMaterial: https://threejs.org/docs/#api/en/materials/ShaderMaterial
- Tailwind CSS 4 (`@theme`): https://tailwindcss.com/docs/theme
- shadcn/ui: https://ui.shadcn.com
- Motion: https://motion.dev/docs/react
- Tiptap: https://tiptap.dev/docs
- KaTeX: https://katex.org/docs/supported.html
- Mermaid, настройки: https://mermaid.js.org/config/schema-docs/config.html
- Vite PWA: https://vite-pwa-org.netlify.app

---

## 12. Как перенести в одиночный HTML

Готовый рабочий файл: `docs/examples/glass-nebula.html`. Он проверен в Chrome в светлой и тёмной теме. В нём есть:
- туманности на three.js 0.186.1 через `importmap` с jsdelivr, без сборки;
- стекло колонки (`.liquid-column`) и 2-го слоя (`.liquid-2`);
- линза: функция `applyLens(el, { bezel, refraction, dispersion, frost })` с картой смещения, маской углов, фильтром и бликом за курсором; без Chromium используется запасное стекло.

Минимальные требования, чтобы выглядело так же:
1. **Фон под стеклом обязателен.** Туманность (`#nebula`, `position: fixed`, `z-index: -1`) или другой контент.
2. **Цвета берутся из токенов раздела 3.** Тёмная тема включается классом `.dark` на `<html>`. Шейдер читает цвет фона из `body` и тему из класса.
3. **Стекло 1-го слоя** `background: var(--sidebar)` + `backdrop-filter: blur(12px) saturate(150%)` + белая кромка `inset … rgb(255 255 255 / sheen·1.6)`. Для стекла 2-го слоя `blur(18px)` и +14 % `--card`.
4. **Линза** вешается на элемент со скруглением: `applyLens(el, …)` вызывается после того, как у элемента появился размер. При изменении размера её нужно вызвать заново.
5. **Не ставить на предков стекла** `filter`, `opacity < 1`, `mask`, `clip-path`, `mix-blend-mode`, `backdrop-filter` или `view-transition-name`. Каждое из этих свойств делает предка новым backdrop root, и стекло перестаёт видеть фон за ним. `transform`, `z-index` и `position: fixed` на это не влияют.
6. **Тонировка туманности:** `uTint = 1` и `uTintCol = RGB 0…1`. Нейтральное «белое» стекло: `uTint = 0`.
