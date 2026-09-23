import { useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { SearchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Обзор', end: true },
  { to: '/graph', label: 'Схема сети' },
  { to: '/top', label: 'Приоритеты' },
  { to: '/clusters', label: 'Кластеры' },
  { to: '/analysis', label: 'Анализ' },
  { to: '/assistant', label: 'Ассистент' },
  { to: '/method', label: 'Метод' },
]

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
          <span className="font-mono">обезличенная выгрузка · июль 2026 · только переводы ≥ 5 000 ₸ внутри банка</span>
        </div>
      </footer>
    </div>
  )
}
