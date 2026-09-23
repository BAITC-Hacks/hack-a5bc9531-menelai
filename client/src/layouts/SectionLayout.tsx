import { NavLink, Outlet } from 'react-router'
import { cn } from '@/lib/utils'

/** Sub-navigation for a section with several screens (Анализ, Метод). */
export default function SectionLayout({ label, tabs }: { label: string; tabs: { to: string; label: string; end?: boolean }[] }) {
  return (
    <>
      <nav aria-label={label} className="-mb-2 flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-card p-1">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                'flex min-h-10 shrink-0 items-center rounded-lg px-3 py-2 text-[13px] whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-accent font-medium text-primary'
                  : 'text-muted-foreground hover:bg-panel-2 hover:text-foreground',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  )
}
