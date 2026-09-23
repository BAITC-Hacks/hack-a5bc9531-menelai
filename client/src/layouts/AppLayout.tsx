import { useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { ChevronDownIcon, DatabaseIcon, SearchIcon, UploadIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api, switchDataset } from '@/lib/api'
import { num, periodLabel } from '@/lib/format'
import { useApi } from '@/lib/use-api'

const NAV = [
  { to: '/', label: 'Главная', end: true },
  { to: '/network', label: 'Сеть' },
  { to: '/analysis', label: 'Проверки' },
  { to: '/top', label: 'Очередь' },
  { to: '/assistant', label: 'Ассистент' },
  { to: '/method', label: 'Методика' },
  { to: '/upload', label: 'Данные' },
]

function DatasetMenu() {
  const { data, error: loadError } = useApi(api.datasets)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const active = data?.datasets.find((d) => d.id === data.active)
  return (
    <><DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 min-w-0 max-w-64 flex-1 items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-[13px] transition-colors hover:border-gold/60 sm:flex-none"
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
            <DropdownMenuItem key={d.id} onClick={() => { if (d.id !== data.active) { setSwitchError(null); void switchDataset(d.id).catch((e: unknown) => setSwitchError(e instanceof Error ? e.message : String(e))) } }} className="grid gap-0.5">
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
    </DropdownMenu>{(loadError || switchError) && <p role="alert" className="text-xs text-destructive">{loadError || switchError}</p>}</>
  )
}

function Logo() {
  return <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
    <path d="M9 10 L22 9 M9 10 L16 23 M22 9 L16 23" stroke="#e0a63a" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    <circle cx="9" cy="10" r="4" fill="var(--role-consolidator)" />
    <circle cx="22" cy="9" r="3.2" fill="var(--role-transit)" />
    <circle cx="16" cy="23" r="4.6" fill="var(--role-coordinator)" />
  </svg>
}

export default function AppLayout() {
  const { data: stats } = useApi(api.stats)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [query, setQuery] = useState('')
  const [searchError, setSearchError] = useState('')
  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    const q = query.replace(/\s/g, '')
    if (!/^\d{1,18}$/.test(q)) {
      setSearchError('Введите ID клиента или его последние цифры — от 1 до 18 цифр.')
      return
    }
    navigate(q.length === 18 ? `/nodes/${q}` : `/graph?q=${q}`)
    setSearchError('')
  }
  return <div className="flex min-h-svh flex-col bg-background text-foreground">
    <a href="#main-content" className="skip-link">Перейти к содержимому</a>
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 md:px-6">
        <Link to="/" aria-label="Граф денег — главная" className="flex shrink-0 items-center gap-2.5 rounded-md">
          <Logo /><span className="font-heading text-[15px] font-bold tracking-tight">Граф денег</span>
        </Link>
        <nav aria-label="Разделы" className="order-3 -mb-2.5 flex w-full min-w-0 gap-0.5 overflow-x-auto lg:order-none lg:mb-0 lg:w-auto">
          {NAV.map(({ to, label, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('relative flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm transition-colors', (isActive || to === '/network' && ['/graph', '/clusters'].includes(pathname)) ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-primary')}>
            {label}
          </NavLink>)}
        </nav>
        <form onSubmit={onSearch} role="search" aria-label="Поиск клиента" className="relative ml-auto flex min-w-0 flex-1 basis-[180px] items-center gap-2 sm:max-w-[310px] xl:max-w-[270px]">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-input bg-card pl-3 pr-1 focus-within:border-primary">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setSearchError('') }} placeholder="Найти клиента по ID" inputMode="numeric" aria-label="Поиск по ID клиента" aria-invalid={!!searchError} aria-describedby={searchError ? 'gid-search-error' : undefined} className="min-w-0 w-full bg-transparent font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground" />
            <button type="submit" aria-label="Найти клиента" className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary">↵</button>
          </label>
          {searchError && <p id="gid-search-error" role="alert" className="absolute top-full right-0 left-0 mt-2 rounded-lg border border-destructive/50 bg-card p-3 text-xs shadow-lg">{searchError}</p>}
        </form>
      </div>
      <div className="mx-auto flex max-w-[1320px] items-center gap-3 border-t px-4 py-2 md:px-6">
        <span className="hidden text-xs text-muted-foreground sm:inline">Активная выписка</span><DatasetMenu />
        <Link to="/upload" className="ml-auto inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-primary hover:bg-accent"><UploadIcon className="size-3.5" aria-hidden />Новый анализ</Link>
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className="mx-auto grid w-full min-w-0 max-w-[1320px] flex-1 content-start gap-8 px-4 pt-7 pb-16 outline-none md:px-6">
      <Outlet />
    </main>
    <footer className="border-t bg-card">
      <div className="mx-auto flex max-w-[1320px] flex-wrap justify-between gap-2 px-4 py-4 text-xs text-muted-foreground md:px-6">
        <p>Все выводы — гипотезы для проверки аналитиком, не утверждения о причастности.</p>
        <p>Обезличенные данные{stats?.period ? ` · ${periodLabel(stats.period)}` : ''}</p>
      </div>
    </footer>
  </div>
}
