import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { SUBJECT_COLOR_IDS, SUBJECT_ICON_IDS } from '@/lib/subjectPalette'
import type { VaultAdapter } from '@/storage/VaultAdapter'
import type { SubjectColor, SubjectIcon } from '@/types'
import type { BoardEdit } from './boards'
import { LocalFiles } from './localFiles'
import { StudyVault } from './vault'

/*
 * MCP-сервер TYPOS: Claude пишет конспекты, закреп, тулзы и доски прямо в хранилище.
 * Запуск: tsx --tsconfig mcp/tsconfig.json mcp/server.ts --vault "C:\путь\к\папке"
 *     или: tsx --tsconfig mcp/tsconfig.json mcp/server.ts --link "typos://…" (сервер хранения; ссылку даёт команда link)
 * Приложение с папкой подхватывает изменения, когда окно получает фокус; с сервером хранения — сразу.
 */

const INSTRUCTIONS = `Хранилище учебных конспектов пользователя (приложение TYPOS, как Apple Notes). Предмет = папка; в нём конспекты (Markdown), закреп (карточки с одной формулой), «Проекты» (HTML-тулзы, PDF, презентации, документы, картинки) и «Доски» (полотна как в Miro: стикеры, карточки, рамки и стрелки).

Формат конспекта — Markdown, который понимает редактор приложения:
- первая строка — заголовок «# …» (по нему называется файл); дальше ## / ### для разделов;
- формулы только $…$ (в строке) и $$…$$ (блок, на отдельных строках). Не используй \\( \\), \\[ \\] и блоки кода с LaTeX;
- внутри $…$ не бывает знака $; обычный доллар — \\$;
- таблицы — GFM (| a | b |), объединённых ячеек нет: повтори значение;
- ==выделение==, **жирный**, *курсив*, > цитата для определений, списки;
- картинки — ![подпись](https://…): сервер сам скачает их в assets/. Для локального файла или data: — сначала add_image.
- матрицы — pmatrix/vmatrix в $$-блоках; расширенная матрица — \\left(\\begin{array}{cc|c}…\\end{array}\\right).

Доска — узлы и стрелки. Узлы: text (карточка; Markdown: #, -, **жирный**, формулы $…$; с color — стикер), group (рамка с label; children — id узлов внутри), link (url), file (картинка: path из add_image). Стрелки: from → to (id узлов), label. Свои id узлов задавай сам — на них ссылаются стрелки. Координаты можно не писать: узлы без x/y расставятся схемой по стрелкам (direction LR или TB) под тем, что уже есть на доске. Цвета: 1 красный, 2 оранжевый, 3 жёлтый, 4 зелёный, 5 голубой, 6 фиолетовый.

Перед записью нескольких конспектов покажи пользователю план (предмет → конспекты). Ответ create/update содержит warnings — если они есть, исправь и обнови конспект.
При переносе из документов передавай source (ссылка на оригинал): повторный перенос обновит тот же конспект, а не создаст дубль.
Удалять насовсем нельзя — trash кладёт в корзину приложения (30 дней).`

const IMAGES_LINE =
  '- картинки — ![подпись](https://…): сервер сам скачает их в assets/. Для локального файла или data: — сначала add_image.'

/**
 * Одинаковые инструменты для локального и удалённого транспорта.
 * Файлы с компьютера (аргумент file, add_project_file, путь в add_image) — только локально и только из папок files.
 */
export function createMcpServer(adapter: VaultAdapter, remote = false, files = new LocalFiles([])) {
  const vault = new StudyVault(adapter, { remote, files })
  const readsFiles = !remote && files.enabled
  const instructions = remote
    ? INSTRUCTIONS.replace(
        IMAGES_LINE,
        '- картинки — передавай в add_image как data:image/…;base64, затем используй возвращённую Markdown-ссылку. Удалённый MCP не читает файлы сервера и не скачивает внешние картинки.',
      )
    : readsFiles
      ? INSTRUCTIONS.replace(
          IMAGES_LINE,
          `- картинки — ![подпись](https://…): сервер сам скачает их в assets/ (только из интернета, не из локальной сети). Для data: или файла из разрешённых папок (${files.roots.join(', ')}) — сначала add_image.`,
        )
      : INSTRUCTIONS.replace(
          IMAGES_LINE,
          '- картинки — ![подпись](https://…): сервер сам скачает их в assets/ (только из интернета, не из локальной сети). Для data: — сначала add_image. Файлы с компьютера MCP не читает: пользователь может разрешить папку флагом --files.',
        )
  const server = new McpServer({ name: 'studynotes', version: '1.0.0' }, { instructions })

  const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
  /** Ошибки — текстом для модели, а не падением сервера. */
  const run =
    <A>(fn: (args: A) => Promise<unknown>) =>
    async (args: A) => {
      try {
        return json(await fn(args))
      } catch (e) {
        return { ...json({ error: e instanceof Error ? e.message : String(e) }), isError: true }
      }
    }

  /** Большой текст можно передать файлом из разрешённой папки — чтобы не гонять десятки КБ через аргументы вызова. */
  async function textArg(inline: string | undefined, file: string | undefined, what: string): Promise<string> {
    if (remote && file !== undefined) throw new Error('Удалённый MCP не читает файлы сервера — передай текст напрямую')
    if (inline) return inline
    if (!readsFiles) throw new Error(`Нужен ${what} — передай текст напрямую`)
    if (!file) throw new Error(`Нужен ${what} или file — путь к файлу в разрешённой папке`)
    return (await files.read(file, 10 * 1024 * 1024)).toString('utf8')
  }
  const fileArg = z
    .string()
    .optional()
    .describe(`Вместо текста: полный путь к файлу в разрешённых папках (${files.roots.join(', ')}) — для больших лекций и страниц`)

  const subject = z.string().describe('Предмет: id или название папки («Математика»)')
  const colors = z.enum(SUBJECT_COLOR_IDS as [SubjectColor, ...SubjectColor[]])
  const icons = z.enum(SUBJECT_ICON_IDS as [SubjectIcon, ...SubjectIcon[]])
  const read = { readOnlyHint: true, openWorldHint: false }
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

  server.registerTool(
    'list_subjects',
    { title: 'Предметы', description: 'Все предметы и сколько в них конспектов, карточек закрепа, тулз и досок.', annotations: read },
    run(() => vault.listSubjects()),
  )

  server.registerTool(
    'get_subject',
    {
      title: 'Содержимое предмета',
      description:
        'Конспекты (id, заголовок, превью), карточки закрепа, тулзы и доски предмета. Отсюда берутся id для read_note / update_note / read_board / update_board.',
      inputSchema: { subject },
      annotations: read,
    },
    run(({ subject }: { subject: string }) => vault.getSubject(subject)),
  )

  server.registerTool(
    'create_subject',
    {
      title: 'Новый предмет',
      description: 'Создаёт предмет (папку). Если такой уже есть — возвращает его.',
      inputSchema: {
        name: z.string().min(1).describe('Название: «Микроэкономика»'),
        color: colors.optional().describe('Цвет иконки предмета'),
        icon: icons.optional().describe('Иконка: sigma — математика, trending — экономика, code — программирование, book — другое…'),
      },
      annotations: write,
    },
    run((a: { name: string; color?: SubjectColor; icon?: SubjectIcon }) => vault.createSubject(a)),
  )

  server.registerTool(
    'read_note',
    { title: 'Прочитать конспект', description: 'Markdown конспекта целиком.', inputSchema: { id: z.string() }, annotations: read },
    run(({ id }: { id: string }) => vault.readNote(id)),
  )

  server.registerTool(
    'create_note',
    {
      title: 'Новый конспект',
      description: 'Создаёт конспект в предмете. С source, который уже встречался в этом предмете, обновляет тот конспект.',
      inputSchema: {
        subject,
        title: z.string().min(1).describe('Заголовок (первая строка и имя файла)'),
        markdown: z.string().optional().describe('Текст в формате из инструкций сервера; заголовок «# …» в начале можно не писать'),
        ...(readsFiles ? { file: fileArg } : {}),
        source: z.string().optional().describe('Ссылка или id оригинала — для повторного переноса без дублей'),
      },
      annotations: write,
    },
    run(async (a: { subject: string; title: string; markdown?: string; file?: string; source?: string }) =>
      vault.createNote({ ...a, markdown: await textArg(a.markdown, a.file, 'markdown') }),
    ),
  )

  server.registerTool(
    'update_note',
    {
      title: 'Изменить конспект',
      description:
        'replace — заменить весь текст; append — дописать в конец; replace_section — заменить содержимое раздела под заголовком section (если markdown начинается с заголовка — заменится и он). Если конспект открыт в приложении, оно подгрузит новую версию или спросит, какую оставить.',
      inputSchema: {
        id: z.string(),
        mode: z.enum(['replace', 'append', 'replace_section']),
        markdown: z.string().optional(),
        ...(readsFiles ? { file: fileArg } : {}),
        section: z.string().optional().describe('Текст заголовка раздела для replace_section, без #'),
      },
      annotations: { ...write, idempotentHint: false },
    },
    run(async (a: { id: string; mode: 'replace' | 'append' | 'replace_section'; markdown?: string; file?: string; section?: string }) =>
      vault.updateNote({ ...a, markdown: await textArg(a.markdown, a.file, 'markdown') }),
    ),
  )

  server.registerTool(
    'add_image',
    {
      title: 'Загрузить картинку',
      description: remote
        ? 'Сохраняет картинку из data:image/…;base64 и возвращает Markdown-ссылку. URL и пути файлов недоступны.'
        : `Сохраняет картинку в предмет (webp) и возвращает Markdown-ссылку ![](assets/…). Источник: https-ссылка (только интернет), data:image/…;base64${readsFiles ? ` или полный путь к файлу в разрешённых папках (${files.roots.join(', ')})` : ''}.`,
      inputSchema: { subject, source: z.string(), alt: z.string().optional().describe('Подпись') },
      annotations: { ...write, openWorldHint: !remote },
    },
    run((a: { subject: string; source: string; alt?: string }) => vault.addImage(a)),
  )

  server.registerTool(
    'create_pin',
    {
      title: 'Карточка в закреп',
      description:
        'Шпаргалка предмета: одна формула (LaTeX без $) и короткий простой текст под ней. Для нескольких формул — aligned/gathered в одном tex.',
      inputSchema: {
        subject,
        title: z.string().min(1),
        tex: z.string().optional().describe('LaTeX без $: «\\det A = ad - bc»'),
        text: z.string().optional().describe('Пояснение простым текстом, без формул'),
      },
      annotations: write,
    },
    run((a: { subject: string; title: string; tex?: string; text?: string }) => vault.createPin(a)),
  )

  server.registerTool(
    'update_pin',
    {
      title: 'Изменить карточку',
      description: 'Меняет заголовок, формулу или текст карточки закрепа (не переданное остаётся).',
      inputSchema: { id: z.string(), title: z.string().optional(), tex: z.string().optional(), text: z.string().optional() },
      annotations: write,
    },
    run((a: { id: string; title?: string; tex?: string; text?: string }) => vault.updatePin(a)),
  )

  server.registerTool(
    'import_tool',
    {
      title: 'Добавить тулзу',
      description:
        'Кладёт самодостаточный HTML (калькулятор, решатель, тренажёр) в «Проекты» предмета. В приложении он работает в песочнице без доступа к данным.',
      inputSchema: {
        subject,
        name: z.string().min(1),
        html: z.string().optional().describe('Полный HTML-документ'),
        ...(readsFiles ? { file: fileArg } : {}),
        icon: z.enum(['grid', 'chart', 'ruler', 'binary', 'calculator', 'function', 'timer', 'table']).optional(),
      },
      annotations: write,
    },
    run(
      async (a: {
        subject: string
        name: string
        html?: string
        file?: string
        icon?: 'grid' | 'chart' | 'ruler' | 'binary' | 'calculator' | 'function' | 'timer' | 'table'
      }) => vault.importTool({ ...a, html: await textArg(a.html, a.file, 'html') }),
    ),
  )

  if (readsFiles)
    server.registerTool(
      'add_project_file',
      {
        title: 'Добавить файл в проекты',
        description:
          'Копирует файл из разрешённых папок компьютера (PDF, PPTX, DOCX, картинка, HTML…) в «Проекты» предмета как есть. В приложении он открывается прямо на сайте.',
        inputSchema: {
          subject,
          file: z.string().describe(`Полный путь к файлу в разрешённых папках (${files.roots.join(', ')})`),
          name: z.string().optional().describe('Название в приложении; по умолчанию — имя файла'),
        },
        annotations: write,
      },
      run(async (a: { subject: string; file: string; name?: string }) =>
        vault.addProjectFile({ subject: a.subject, fileName: a.file, data: await files.read(a.file, 100 * 1024 * 1024), title: a.name }),
      ),
    )

  const boardNode = z.object({
    id: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('Свой id: на него ссылаются стрелки и children. Узел с таким id уже есть — правятся только переданные поля'),
    type: z
      .enum(['text', 'group', 'link', 'file'])
      .optional()
      .describe('text — карточка (по умолчанию), group — рамка, link — ссылка, file — картинка'),
    text: z.string().optional().describe('Для text: Markdown (#, -, **жирный**, формулы $…$ и $$…$$)'),
    label: z.string().optional().describe('Для group: подпись рамки'),
    children: z.array(z.string()).optional().describe('Для group без координат: id узлов, вокруг которых встанет рамка'),
    url: z.string().optional().describe('Для link: https://…'),
    file: z.string().optional().describe('Для file: path картинки из ответа add_image'),
    color: z.string().optional().describe('1…6 (красный, оранжевый, жёлтый, зелёный, голубой, фиолетовый) или #rrggbb; "" — убрать'),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  const boardEdge = z.object({
    id: z.string().min(1).max(64).optional().describe('Стрелка с таким id уже есть — правятся переданные поля'),
    from: z.string().optional().describe('id узла, откуда стрелка (для новой — обязательно)'),
    to: z.string().optional().describe('id узла, куда стрелка (для новой — обязательно)'),
    label: z.string().optional(),
    color: z.string().optional(),
    arrow: z.enum(['end', 'both', 'none']).optional().describe('Наконечники: end — у to (по умолчанию), both, none'),
  })
  const boardShape = {
    nodes: z.array(boardNode).max(500).optional(),
    edges: z.array(boardEdge).max(1000).optional(),
    direction: z
      .enum(['LR', 'TB'])
      .optional()
      .describe('Как расставлять узлы без координат: LR — слева направо (по умолчанию), TB — сверху вниз'),
  }

  server.registerTool(
    'read_board',
    { title: 'Прочитать доску', description: 'Узлы (с координатами) и стрелки доски.', inputSchema: { id: z.string() }, annotations: read },
    run(({ id }: { id: string }) => vault.readBoard(id)),
  )

  server.registerTool(
    'create_board',
    {
      title: 'Новая доска',
      description:
        'Создаёт доску в предмете: майнд-карта, схема темы, сравнение в рамках. Узлы без x/y расставятся схемой по стрелкам. Ответ — id доски и id узлов по порядку.',
      inputSchema: { subject, name: z.string().min(1).describe('Название (имя файла)'), ...boardShape },
      annotations: write,
    },
    run((a: { subject: string; name: string } & BoardEdit) => vault.createBoard(a)),
  )

  server.registerTool(
    'update_board',
    {
      title: 'Изменить доску',
      description:
        'Добавляет и правит узлы и стрелки (по id), удаляет по id (remove — узлы вместе с их стрелками), переименовывает. Новые узлы без x/y встанут под тем, что уже есть. Если доска открыта в приложении, оно сольёт правки со своими.',
      inputSchema: {
        id: z.string(),
        name: z.string().optional().describe('Новое название'),
        ...boardShape,
        remove: z.array(z.string()).optional().describe('id узлов и стрелок для удаления'),
      },
      annotations: { ...write, idempotentHint: false },
    },
    run((a: { id: string; name?: string } & BoardEdit) => vault.updateBoard(a)),
  )

  server.registerTool(
    'search',
    {
      title: 'Поиск',
      description: 'Ищет по конспектам, закрепу и доскам (все слова запроса, без учёта регистра и ё/е).',
      inputSchema: { query: z.string().min(1), subject: subject.optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: read,
    },
    run((a: { query: string; subject?: string; limit?: number }) => vault.search(a)),
  )

  server.registerTool(
    'trash',
    {
      title: 'В корзину',
      description: 'Переносит конспект, карточку, тулзу или доску в корзину приложения. Восстанавливается там же в течение 30 дней.',
      inputSchema: { kind: z.enum(['note', 'pin', 'tool', 'board']), id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    run((a: { kind: 'note' | 'pin' | 'tool' | 'board'; id: string }) => vault.trash(a)),
  )

  return server
}
