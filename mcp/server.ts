import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { SUBJECT_COLOR_IDS, SUBJECT_ICON_IDS } from '@/lib/subjectPalette'
import type { SubjectColor, SubjectIcon } from '@/types'
import { openVault } from './open'
import { StudyVault } from './vault'

/*
 * MCP-сервер TYPOS: Claude пишет конспекты, закреп и тулзы прямо в хранилище.
 * Запуск: tsx --tsconfig mcp/tsconfig.json mcp/server.ts --vault "C:\путь\к\папке"
 *     или: tsx --tsconfig mcp/tsconfig.json mcp/server.ts --link "typos://…" (сервер хранения; ссылку даёт команда link)
 * Приложение с папкой подхватывает изменения, когда окно получает фокус; с сервером хранения — сразу.
 */

const vault = new StudyVault(await openVault(process.argv, process.env))

const INSTRUCTIONS = `Хранилище учебных конспектов пользователя (приложение TYPOS, как Apple Notes). Предмет = папка; в нём конспекты (Markdown), закреп (карточки с одной формулой) и тулзы (HTML).

Формат конспекта — Markdown, который понимает редактор приложения:
- первая строка — заголовок «# …» (по нему называется файл); дальше ## / ### для разделов;
- формулы только $…$ (в строке) и $$…$$ (блок, на отдельных строках). Не используй \\( \\), \\[ \\] и блоки кода с LaTeX;
- внутри $…$ не бывает знака $; обычный доллар — \\$;
- таблицы — GFM (| a | b |), объединённых ячеек нет: повтори значение;
- ==выделение==, **жирный**, *курсив*, > цитата для определений, списки;
- картинки — ![подпись](https://…): сервер сам скачает их в assets/. Для локального файла или data: — сначала add_image.
- матрицы — pmatrix/vmatrix в $$-блоках; расширенная матрица — \\left(\\begin{array}{cc|c}…\\end{array}\\right).

Перед записью нескольких конспектов покажи пользователю план (предмет → конспекты). Ответ create/update содержит warnings — если они есть, исправь и обнови конспект.
При переносе из документов передавай source (ссылка на оригинал): повторный перенос обновит тот же конспект, а не создаст дубль.
Удалять насовсем нельзя — trash кладёт в корзину приложения (30 дней).`

const server = new McpServer({ name: 'studynotes', version: '1.0.0' }, { instructions: INSTRUCTIONS })

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

const subject = z.string().describe('Предмет: id или название папки («Математика»)')
const colors = z.enum(SUBJECT_COLOR_IDS as [SubjectColor, ...SubjectColor[]])
const icons = z.enum(SUBJECT_ICON_IDS as [SubjectIcon, ...SubjectIcon[]])
const read = { readOnlyHint: true, openWorldHint: false }
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

server.registerTool(
  'list_subjects',
  { title: 'Предметы', description: 'Все предметы и сколько в них конспектов, карточек закрепа и тулз.', annotations: read },
  run(() => vault.listSubjects()),
)

server.registerTool(
  'get_subject',
  {
    title: 'Содержимое предмета',
    description: 'Конспекты (id, заголовок, превью), карточки закрепа и тулзы предмета. Отсюда берутся id для read_note / update_note.',
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
      markdown: z.string().describe('Текст в формате из инструкций сервера; заголовок «# …» в начале можно не писать'),
      source: z.string().optional().describe('Ссылка или id оригинала — для повторного переноса без дублей'),
    },
    annotations: write,
  },
  run((a: { subject: string; title: string; markdown: string; source?: string }) => vault.createNote(a)),
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
      markdown: z.string(),
      section: z.string().optional().describe('Текст заголовка раздела для replace_section, без #'),
    },
    annotations: { ...write, idempotentHint: false },
  },
  run((a: { id: string; mode: 'replace' | 'append' | 'replace_section'; markdown: string; section?: string }) => vault.updateNote(a)),
)

server.registerTool(
  'add_image',
  {
    title: 'Загрузить картинку',
    description:
      'Сохраняет картинку в предмет (webp) и возвращает Markdown-ссылку ![](assets/…) — вставь её в текст конспекта. Источник: https-ссылка, data:image/…;base64 или путь к файлу на компьютере.',
    inputSchema: { subject, source: z.string(), alt: z.string().optional().describe('Подпись') },
    annotations: { ...write, openWorldHint: true },
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
      'Кладёт самодостаточный HTML (калькулятор, решатель, тренажёр) в «Инструменты» предмета. В приложении он работает в песочнице без доступа к данным.',
    inputSchema: {
      subject,
      name: z.string().min(1),
      html: z.string().min(1).describe('Полный HTML-документ'),
      icon: z.enum(['grid', 'chart', 'ruler', 'binary', 'calculator', 'function', 'timer', 'table']).optional(),
    },
    annotations: write,
  },
  run(
    (a: {
      subject: string
      name: string
      html: string
      icon?: 'grid' | 'chart' | 'ruler' | 'binary' | 'calculator' | 'function' | 'timer' | 'table'
    }) => vault.importTool(a),
  ),
)

server.registerTool(
  'search',
  {
    title: 'Поиск',
    description: 'Ищет по конспектам и закрепу (все слова запроса, без учёта регистра и ё/е).',
    inputSchema: { query: z.string().min(1), subject: subject.optional(), limit: z.number().int().min(1).max(100).optional() },
    annotations: read,
  },
  run((a: { query: string; subject?: string; limit?: number }) => vault.search(a)),
)

server.registerTool(
  'trash',
  {
    title: 'В корзину',
    description: 'Переносит конспект, карточку или тулзу в корзину приложения. Восстанавливается там же в течение 30 дней.',
    inputSchema: { kind: z.enum(['note', 'pin', 'tool']), id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  run((a: { kind: 'note' | 'pin' | 'tool'; id: string }) => vault.trash(a)),
)

await server.connect(new StdioServerTransport())
