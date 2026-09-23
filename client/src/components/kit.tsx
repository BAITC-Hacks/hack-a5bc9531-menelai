// Shared building blocks of the «Граф денег» design system. Pages compose these instead of ad-hoc markup.
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { ROLES, type Role } from '@/lib/api'
import { dec, gidTail } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'


export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('eyebrow', className)}>{children}</div>
}

/** Page title block: mono eyebrow, display heading, short lede, optional right-side slot. */
export function PageHeader({
  eyebrow,
  title,
  lede,
  aside,
}: {
  eyebrow: ReactNode
  title: ReactNode
  lede?: ReactNode
  aside?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
      <div className="grid max-w-3xl gap-3">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="font-heading text-3xl leading-[1.05] font-bold tracking-tight md:text-[40px]">{title}</h1>
        {lede && <p className="max-w-[68ch] text-[15px] text-ink-2">{lede}</p>}
      </div>
      {aside}
    </header>
  )
}

/** Horizontal stat strip with hairline dividers; values are mono and tabular. */
export function StatStrip({
  items,
  className,
}: {
  items: { value: ReactNode; label: ReactNode; tone?: string }[]
  className?: string
}) {
  return (
    <dl className={cn('flex flex-wrap border-y', className)}>
      {items.map((s, i) => (
        <div key={i} className="grid gap-0.5 border-r py-3.5 pr-6 pl-0 last:border-r-0 [&:not(:first-child)]:pl-6">
          <dd className="font-mono text-2xl leading-tight font-medium tnum" style={s.tone ? { color: s.tone } : undefined}>
            {s.value}
          </dd>
          <dt className="text-xs text-muted-foreground">{s.label}</dt>
        </div>
      ))}
    </dl>
  )
}

/** Bordered surface with an optional header row. */
export function Panel({
  title,
  eyebrow,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  eyebrow?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-xl border bg-card', className)}>
      {(title || eyebrow || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="grid gap-1.5">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Tabbed filter/sort control: pill buttons with an optional mono count. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: ReactNode; count?: number }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div role="tablist" className={cn('inline-flex flex-wrap gap-1 rounded-lg border bg-panel-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
            o.value === value ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
          {o.count != null && <span className="ml-1.5 font-mono text-[11px] tnum text-muted-foreground">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Horizontal composition bar: role counts as proportional colored segments, hover shows count. */
export function RoleStackBar({ counts, className }: { counts: Partial<Record<Role, number>>; className?: string }) {
  const total = ROLES.reduce((sum, r) => sum + (counts[r] ?? 0), 0)
  if (!total) return null
  return (
    <div role="img" aria-label="Состав по ролям" className={cn('flex h-2 w-full overflow-hidden rounded-full bg-panel-2', className)}>
      {ROLES.filter((r) => counts[r]).map((r) => (
        <span
          key={r}
          title={`${ROLE[r].label}: ${counts[r]}`}
          style={{ width: `${((counts[r] ?? 0) / total) * 100}%`, background: ROLE[r].color }}
        />
      ))}
    </div>
  )
}

export function RoleDot({ role, className }: { role: Role; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ background: ROLE[role].color }}
    />
  )
}

/** Role pill: colored dot + Russian label, tinted border in the role color. */
export function RoleChip({ role, className }: { role: Role; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
      style={{
        borderColor: `color-mix(in srgb, ${ROLE[role].color} 45%, transparent)`,
        background: `color-mix(in srgb, ${ROLE[role].color} 12%, transparent)`,
      }}
    >
      <RoleDot role={role} className="size-2" />
      {ROLE[role].label}
    </span>
  )
}

/** Dashed tag: marks text as a hypothesis for review, not a finding. */
export function HypTag({ children = 'гипотеза' }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-dashed border-gold/50 px-1.5 py-px font-mono text-[10.5px] tracking-wider text-gold uppercase">
      {children}
    </span>
  )
}

export function SeedTag() {
  return (
    <span className="inline-flex items-center rounded-full border border-seed/60 bg-seed/10 px-1.5 py-px font-mono text-[10.5px] font-medium tracking-wider text-seed uppercase">
      seed
    </span>
  )
}

/** gid as a mono link to its card. `short` shows the last ten digits (full gid in title). */
export function GidLink({ gid, short, className }: { gid: string; short?: boolean; className?: string }) {
  return (
    <Link
      to={`/nodes/${gid}`}
      title={gid}
      className={cn(
        'font-mono text-[13px] whitespace-nowrap text-foreground underline decoration-line-2 decoration-dotted underline-offset-4 transition-colors hover:text-gold hover:decoration-gold',
        className,
      )}
    >
      {short ? gidTail(gid) : gid}
    </Link>
  )
}

/** 0–1 score as a thin gold bar plus its value. */
export function PriorityBar({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-panel-2 ring-1 ring-border">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-linear-to-r from-gold-deep to-gold"
          style={{ width: `${Math.max(2, value * 100)}%` }}
        />
      </span>
      <span className="font-mono text-[13px] tnum">{dec(value)}</span>
    </span>
  )
}

/** Proportional horizontal bar (0..max), any CSS `background` (color, gradient, pattern). */
export function Bar({ value, max, background, className }: { value: number; max: number; background: string; className?: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <span className={cn('relative block h-2.5 overflow-hidden rounded-full bg-panel-2 ring-1 ring-border', className)}>
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(value > 0 ? 1.5 : 0, w)}%`, background }} />
    </span>
  )
}

function useReducedMotion() {
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  return reduced
}

/** SVG 320×140 flow schematic for a role: grey = other nodes, role color = the node itself, gold dots trace money via SMIL. */
function schem(role: Role, reduced: boolean): string {
  const grey = 'var(--line-2)'
  const color = ROLE[role].color
  const cy = 70
  const edges: { d: string; dashed?: boolean }[] = []
  let dots = ''
  let nodes = ''
  const nd = (x: number, y: number, r: number, c: string, ring?: boolean) =>
    ring
      ? `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c}" stroke-width="1.8"/>`
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`
  const flow = (pts: [number, number][], i: number, dur = 2.2, dashed = false) => {
    const d = 'M' + pts.map((p) => p.join(',')).join(' L')
    edges.push({ d, dashed })
    if (!reduced) dots += `<circle r="2.6" fill="var(--gold)"><animateMotion dur="${dur}s" begin="-${(i * 0.37) % dur}s" repeatCount="indefinite" path="${d}"/></circle>`
  }

  if (role === 'consolidator') {
    ;([[30, 20], [30, 48], [30, 76], [30, 104], [70, 118], [70, 22]] as [number, number][]).forEach((p, i) => {
      flow([p, [160, cy]], i)
      nodes += nd(p[0], p[1], 5, grey)
    })
    flow([[160, cy], [290, cy]], 6, 3.4)
    nodes += nd(290, cy, 4, grey) + nd(160, cy, 13, color)
  } else if (role === 'transit') {
    flow([[40, cy], [160, cy]], 0, 1.6)
    flow([[40, cy], [160, cy]], 2, 1.6)
    flow([[160, cy], [280, cy]], 1, 1.6)
    flow([[160, cy], [280, cy]], 3, 1.6)
    nodes += nd(40, cy, 6, grey) + nd(280, cy, 6, grey) + nd(160, cy, 10, color, true)
  } else if (role === 'distributor') {
    for (let i = 0; i < 9; i++) {
      const a = -1.1 + i * 0.275
      const p: [number, number] = [Math.min(300, 70 + Math.cos(a) * 130), cy + Math.sin(a) * 58]
      flow([[70, cy], p], i, 2.4)
      nodes += nd(p[0], p[1], 4, grey)
    }
    flow([[15, cy], [70, cy]], 0, 1.6)
    nodes += nd(15, cy, 4, grey) + nd(70, cy, 12, color)
  } else if (role === 'terminal') {
    ;([[40, 35], [40, 105]] as [number, number][]).forEach((p, i) => {
      flow([p, [160, cy]], i, 2)
      nodes += nd(p[0], p[1], 6, grey)
    })
    nodes += nd(160, cy, 11, color) + `<text x="182" y="${cy + 4}" fill="var(--muted-foreground)" font-size="11" font-family="var(--font-mono)">остаётся</text>`
  } else if (role === 'coordinator') {
    edges.push({ d: 'M10,70 L90,70', dashed: true })
    nodes += `<text x="4" y="55" fill="var(--muted-foreground)" font-size="11" font-family="var(--font-mono)">вне данных</text>`
    ;([[180, 25], [180, 70], [180, 115]] as [number, number][]).forEach((m, i) => {
      flow([[90, cy], m], i + 1, 2)
      nodes += nd(m[0], m[1], 7, grey)
      ;([[280, m[1] - 12], [280, m[1] + 12]] as [number, number][]).forEach((q, j) => {
        flow([m, q], i * 2 + j + 4, 1.8)
        nodes += nd(q[0], q[1], 3.5, grey)
      })
    })
    nodes += nd(90, cy, 13, color)
  } else {
    flow([[70, cy], [230, cy]], 0, 3.4)
    nodes += nd(70, cy, 6, grey) + nd(230, cy, 4, grey)
  }

  const ep = edges.map(({ d, dashed }) => `<path d="${d}" stroke="${grey}" stroke-width="1.4" fill="none" ${dashed ? 'stroke-dasharray="4 4"' : ''}/>`).join('')
  return `<svg viewBox="0 0 320 140" aria-hidden="true">${ep}${dots}${nodes}</svg>`
}

/** Small animated flow diagram illustrating a role's cascade rule; static (no dots) under prefers-reduced-motion. */
export function RoleFlow({ role, className }: { role: Role; className?: string }) {
  const reduced = useReducedMotion()
  // eslint-disable-next-line react/no-danger -- fixed, self-generated markup (no user input)
  return <div className={cn('[&_svg]:h-auto [&_svg]:w-full', className)} dangerouslySetInnerHTML={{ __html: schem(role, reduced) }} />
}

/** Placeholder while loading, or an error panel with retry. Render when `data` is still null. */
export function LoadState({ error, reload, label = 'Загрузка…' }: { error: string | null; reload: () => void; label?: string }) {
  if (!error)
    return (
      <div className="grid gap-3" aria-busy>
        <div className="h-8 w-64 animate-pulse rounded-md bg-panel-2" />
        <div className="h-40 animate-pulse rounded-xl bg-card" />
        <span className="sr-only">{label}</span>
      </div>
    )
  return (
    <Panel eyebrow="ошибка" title="Не удалось получить данные">
      <div className="grid justify-items-start gap-3">
        <p className="text-sm text-ink-2">
          {error}. Проверьте, что сервер запущен (<code className="font-mono">bun run dev</code>) и пайплайн создал папку{' '}
          <code className="font-mono">out/</code>.
        </p>
        <Button variant="outline" onClick={reload}>
          Повторить
        </Button>
      </div>
    </Panel>
  )
}
