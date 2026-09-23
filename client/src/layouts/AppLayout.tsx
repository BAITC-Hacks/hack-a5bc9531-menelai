import { useState, type FormEvent } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Обзор', end: true },
  { to: '/graph', label: 'Схема сети' },
  { to: '/top', label: 'Топ приоритетов' },
  { to: '/clusters', label: 'Кластеры' },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    const gid = query.replace(/\D/g, '')
    if (gid) navigate(`/nodes/${gid}`)
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-6 border-b px-6 py-4">
        <h1 className="text-xl font-semibold">Граф денег</h1>
        <nav className="flex gap-1">
          {NAV.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-muted',
                  isActive ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <form onSubmit={onSearch} className="ml-auto flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="GID узла"
            inputMode="numeric"
            className="w-56"
          />
          <Button type="submit" variant="secondary">
            Найти
          </Button>
        </form>
      </header>
      <main className="flex flex-col gap-6 p-6">
        <Outlet />
      </main>
    </div>
  )
}
