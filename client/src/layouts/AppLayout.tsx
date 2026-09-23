import { useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { ChevronDownIcon, DatabaseIcon, SearchIcon, UploadIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { api, switchDataset } from '@/lib/api'
import { num, periodLabel } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Обзор', end: true },
  { to: '/graph', label: 'Схема сети' },
  { to: '/top', label: 'Приоритеты' },
  { to: '/clusters', label: 'Кластеры' },
  { to: '/analysis', label: 'Анализ' },
  { to: '/assistant', label: 'Ассистент' },
  { to: '/method', label: 'Метод' },
  { to: '/upload', label: 'Данные' },
]

function DatasetMenu() {
  const { data } = useApi(api.datasets)
  const active = data?.datasets.find((d) => d.id === data.active)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 max-w-64 items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-[13px] transition-colors hover:border-gold/60"
        aria-label="Активная выгрузка"
      >
        <DatabaseIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="grid min-w-0 leading-tight">
          <span className="truncate font-medium">{active?.name ?? 'нет выгрузки'}</span>
          {active?.period && <span className="font-mono text-[10.5px] text-muted-foreground">{periodLabel(active.period)}</span>}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Выгрузки</DropdownMenuLabel>
          {data?.datasets.map((d) => (
            <DropdownMenuItem key={d.id} onClick={() => d.id !== data.active && switchDataset(d.id)} className="grid gap-0.5">
              <span className="flex items-center gap-2">
                <span className={cn('size-1.5 shrink-0 rounded-full', d.id === data.active ? 'bg-gold' : 'bg-transparent')} aria-hidden />
                <span className="truncate font-medium">{d.name}</span>
                {d.source === 'bundled' && <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">демо</span>}
              </span>
              <span className="pl-3.5 font-mono text-[11px] text-muted-foreground">
                {num(d.nodes)} узлов{d.period ? ` · ${periodLabel(d.period)}` : ''}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/upload" />}>
          <UploadIcon aria-hidden /> Загрузить новую…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
      <path d="M9 10 L22 9 M9 10 L16 23 M22 9 L16 23" stroke="var(--gold)" strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
      <circle cx="9" cy="10" r="4" fill="var(--role-consolidator)" />
      <circle cx="22" cy="9" r="3.2" fill="var(--role-transit)" />
      <circle cx="16" cy="23" r="4.6" fill="var(--role-coordinator)" />
    </svg>
  )
}

export default function AppLayout() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const { data: stats } = useApi(api.stats)

  // A full 18-digit gid opens its card; a tail is resolved by suffix on the network screen.
  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    const q = query.replace(/\D/g, '')
    if (!q) return
    navigate(q.length >= 18 ? `/nodes/${q}` : `/graph?q=${q}`)
    setQuery('')
  }

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-2.5 md:px-6">
          <Link to="/" className="flex items-center gap-2.5 rounded-md">
            <Logo />
            <span className="font-heading text-[15px] font-bold tracking-tight">Граф денег</span>
          </Link>
          <nav aria-label="Разделы" className="-mx-1 flex max-w-full gap-0.5 overflow-x-auto">
            {NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'relative rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors hover:text-foreground',
                    isActive
                      ? 'font-medium text-foreground after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:rounded-full after:bg-gold'
                      : 'text-muted-foreground',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <DatasetMenu />
          <form onSubmit={onSearch} role="search" className="ml-auto flex w-full items-center sm:w-auto">
            <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 transition-colors focus-within:border-gold/60 sm:w-72">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="gid или его хвост"
                inputMode="numeric"
                aria-label="Поиск узла по gid или последним цифрам"
                className="w-full bg-transparent font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground"
              />
              <kbd className="hidden rounded border px-1.5 font-mono text-[10px] text-muted-foreground sm:inline">↵</kbd>
            </label>
          </form>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-[1360px] flex-1 content-start gap-10 px-4 pt-8 pb-16 md:px-6">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-[1360px] flex-wrap justify-between gap-2 px-4 py-4 text-xs text-muted-foreground md:px-6">
          <span>Все выводы — гипотезы для проверки аналитиком, не утверждения о причастности.</span>
          <span className="font-mono">
            обезличенная выгрузка{stats ? ` · ${periodLabel(stats.period)} · только переводы ≥ ${num(stats.minTxKzt)} ₸ внутри банка` : ''}
          </span>
        </div>
      </footer>
    </div>
  )
}
