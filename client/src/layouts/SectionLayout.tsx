import { NavLink, Outlet } from 'react-router'
import { cn } from '@/lib/utils'

/** Sub-navigation for a section with several screens (Анализ, Метод). */
export default function SectionLayout({ label, tabs }: { label: string; tabs: { to: string; label: string }[] }) {
  return (
    <>
      <nav aria-label={label} className="-mb-4 flex max-w-full items-center gap-1 overflow-x-auto">
        <span className="eyebrow mr-3 hidden sm:inline">{label}</span>
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                'rounded-full border px-3 py-1 text-[13px] whitespace-nowrap transition-colors',
                isActive
                  ? 'border-gold/50 bg-gold/10 font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
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
