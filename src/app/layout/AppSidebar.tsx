import { Droplets, FolderOpen, Home, Monitor, MonitorDown, Moon, Plus, Search, Server, Sparkles, Sun, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { TyposMark } from '@/components/TyposMark'
import { Kbd } from '@/components/ui/kbd'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { openNewSubject } from '@/features/subjects/NewSubjectDialog'
import { SubjectTree } from '@/features/subjects/SubjectTree'
import { upperFirst } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useConnection } from '@/storage/connection'
import { useSync } from '@/storage/sync'
import { storageLabel } from '@/storage/VaultAdapter'
import { useVault } from '@/vault/store'
import { shuffleBackground } from '../accent'
import { useInstallPrompt } from '../pwa'
import { useUi } from '../store'

const themeMeta = {
  system: { icon: Monitor, label: 'Тема: как в системе' },
  light: { icon: Sun, label: 'Тема: светлая' },
  dark: { icon: Moon, label: 'Тема: тёмная' },
} as const

export function AppSidebar() {
  const { pathname } = useLocation()
  const theme = useUi((s) => s.theme)
  const cycleTheme = useUi((s) => s.cycleTheme)
  const backdrop = useUi((s) => s.backdrop)
  const toggleBackdrop = useUi((s) => s.toggleBackdrop)
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const ThemeIcon = themeMeta[theme].icon
  const storage = useVault((s) => s.adapter)
  const connection = useConnection((s) => s.status)
  const pending = useSync((s) => s.pending)
  const install = useInstallPrompt()
  const [spins, setSpins] = useState(0)

  return (
    <Sidebar collapsible="offcanvas" className="border-r-0">
      <SidebarHeader data-tauri-drag-region className="gap-3 px-3 pt-4">
        <div data-tauri-drag-region className="flex items-center gap-2 px-1">
          {/* логотип — кнопка «перемешать фон» */}
          <motion.button
            type="button"
            aria-label="Перемешать фон"
            title="Перемешать фон"
            onClick={() => {
              shuffleBackground()
              setSpins((n) => n + 1)
            }}
            animate={{ rotate: spins * 360 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <TyposMark className="h-[26px] w-auto" />
          </motion.button>
          <span className="font-brand text-[15px] font-semibold tracking-[0.06em]">TYPOS</span>
        </div>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="liquid-2 flex h-9 items-center gap-2 rounded-xl px-3 text-sm text-sidebar-foreground transition-colors duration-(--dur-fast) hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">Поиск</span>
          <Kbd>Ctrl K</Kbd>
        </button>
      </SidebarHeader>

      <SidebarContent className="thin-scrollbar px-1">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === '/'}>
                  <Link to="/">
                    <Home />
                    <span>Главная</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Предметы</SidebarGroupLabel>
          <SidebarGroupAction title="Новый предмет" aria-label="Новый предмет" onClick={openNewSubject}>
            <Plus />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SubjectTree />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-3 pb-3">
        <SidebarMenu>
          {install.available && (
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => void install.install()} className="text-highlight">
                <MonitorDown />
                <span>Установить приложение</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === '/trash'}>
              <Link to="/trash" viewTransition>
                <Trash2 />
                <span>Корзина</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link to="/welcome">
                {storage?.kind === 'remote' ? <Server /> : <FolderOpen />}
                <span className="truncate">{upperFirst(storageLabel(storage) ?? 'в браузере · подключить папку')}</span>
                {storage?.kind === 'remote' && pending > 0 && (
                  <span
                    className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums"
                    title="Правки, которые ещё не ушли на сервер"
                  >
                    ↑{pending}
                  </span>
                )}
                {(connection === 'offline' || connection === 'revoked') && (
                  <span className={cn('size-2 shrink-0 rounded-full bg-destructive', !pending && 'ml-auto')} aria-label="нет связи" />
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleBackdrop} aria-label={backdrop === 'metal' ? 'Фон: металл' : 'Фон: туманность'}>
              {backdrop === 'metal' ? <Droplets /> : <Sparkles />}
              <span>{backdrop === 'metal' ? 'Фон: металл' : 'Фон: туманность'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={cycleTheme} aria-label={themeMeta[theme].label}>
              <ThemeIcon />
              <span>{themeMeta[theme].label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
