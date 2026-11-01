import { PluginKey } from '@tiptap/pm/state'
import { useEditorState, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { BetweenHorizontalEnd, BetweenVerticalEnd, PanelTop, Trash2, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useLiquidLens } from '@/components/ui/liquid-lens'
import { cn } from '@/lib/utils'

const key = new PluginKey('tableMenu')
const keep = (e: React.MouseEvent) => e.preventDefault()

function tableDom(editor: Editor): HTMLElement | null {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') return editor.view.nodeDOM($from.before(d)) as HTMLElement | null
  }
  return null
}

function Action({
  icon: Icon,
  label,
  title,
  onClick,
  danger,
}: {
  icon?: LucideIcon
  label: string
  title?: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={keep}
      onClick={onClick}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium outline-none transition-[background-color,color,transform] duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring active:scale-95',
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground/85 hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      {Icon && <Icon className="size-4" strokeWidth={1.9} />}
      {label}
    </button>
  )
}

const Sep = () => <div aria-hidden className="mx-0.5 h-5 w-px bg-border" />

export function TableMenu({ editor }: { editor: Editor }) {
  const header = useEditorState({ editor, selector: ({ editor: e }) => e.isActive('tableHeader') })
  const c = () => editor.chain().focus()
  const lens = useLiquidLens({ bezel: 14, refraction: 12, dispersion: 0.09, frost: 5, variant: 'menu', fallback: 'liquid liquid-lava' })

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={key}
      options={{ placement: 'top-start', offset: 8, flip: true, shift: { padding: 12 } }}
      shouldShow={({ editor: e, from, to }) => e.isEditable && from === to && e.isActive('table')}
      getReferencedVirtualElement={() => {
        const el = tableDom(editor)
        return el ? { getBoundingClientRect: () => el.getBoundingClientRect() } : null
      }}
      className="z-30"
    >
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 34 }}
        ref={lens.attach}
        role="toolbar"
        aria-label="Таблица"
        style={lens.style}
        className={cn(lens.className, 'flex items-center gap-0.5 rounded-2xl p-1')}
      >
        {lens.extras}
        <Action icon={BetweenHorizontalEnd} label="Строка" title="Добавить строку ниже" onClick={() => c().addRowAfter().run()} />
        <Action icon={BetweenVerticalEnd} label="Столбец" title="Добавить столбец справа" onClick={() => c().addColumnAfter().run()} />
        <Sep />
        <button
          type="button"
          title="Первая строка — шапка"
          aria-label="Шапка таблицы"
          aria-pressed={header}
          onMouseDown={keep}
          onClick={() => c().toggleHeaderRow().run()}
          className={cn(
            'flex size-8 items-center justify-center rounded-lg outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring',
            header ? 'liquid-active' : 'text-foreground/80 hover:bg-foreground/5',
          )}
        >
          <PanelTop className="size-4" strokeWidth={1.9} />
        </button>
        <Sep />
        <Trash2 aria-hidden className="mx-1 size-4 text-muted-foreground" strokeWidth={1.9} />
        <Action label="строку" title="Удалить строку" onClick={() => c().deleteRow().run()} />
        <Action label="столбец" title="Удалить столбец" onClick={() => c().deleteColumn().run()} />
        <Action label="таблицу" title="Удалить таблицу" danger onClick={() => c().deleteTable().run()} />
      </motion.div>
    </BubbleMenu>
  )
}
