// Canvas renderer for the network screen: pan/zoom, hover tooltip, ego highlight, money-flow particles.
// Ported from the prototype artifact; all mutable view state lives in refs so the rAF loop never re-renders React.
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { ROLE } from '@/lib/roles'
import { ROLES, type Edge, type LaidOutNode, type Role } from '@/lib/api'
import { dec, gidTail, kztShort, num } from '@/lib/format'
import { depthColor } from '@/lib/depth'

export type ColorBy = 'role' | 'depth' | 'cluster'

/** Graph indexed by position (gids stay strings; indices are array positions). Built once per payload. */
export type Model = {
  nodes: LaidOutNode[]
  edges: Edge[]
  byGid: Map<string, number>
  xs: Float32Array
  ys: Float32Array
  src: Int32Array
  dst: Int32Array
  /** edge indices per node */
  out: number[][]
  inn: number[][]
  role: Role[]
  rad: Float32Array
  /** top-10 by pipeline priority — labelled when zoomed in */
  labels: number[]
  /** 8 largest clusters by node count, largest first */
  topClusters: { id: number; n: number }[]
  /** last crawl hop: nodes there were not expanded */
  maxDepth: number
}

export type CanvasHandle = {
  /** fit the given node indices (all nodes when omitted) into the view */
  fit: (ids?: number[]) => void
  /** center on a node and zoom to its direct counterparties */
  focus: (i: number) => void
}

type Props = {
  model: Model
  colorBy: ColorBy
  flow: boolean
  /** 1 = drawn at full strength, 0 = muted by filters / cluster highlight */
  active: Uint8Array
  selected: number | null
  onSelect: (i: number | null) => void
  ref?: Ref<CanvasHandle>
}

const CAT = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#2fa52f', '#9085e9', '#e66767']
const OTHER = '#3b4452'
const IN_BLUE = '#78beff'
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

export default function NetworkCanvas(props: Props) {
  const { model, colorBy, flow, selected, ref } = props
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const p = useRef(props)
  const dirty = useRef(true)
  const cmd = useRef<CanvasHandle | null>(null)

  useEffect(() => {
    p.current = props
    dirty.current = true
  })

  useImperativeHandle(ref, () => ({ fit: (ids) => cmd.current?.fit(ids), focus: (i) => cmd.current?.focus(i) }), [])

  useEffect(() => {
    const stage = stageRef.current!
    const cv = canvasRef.current!
    const tip = tipRef.current!
    const ctx = cv.getContext('2d')!
    const M = model
    const N = M.nodes.length
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string) => cs.getPropertyValue(name).trim()
    const C = {
      gold: v('--gold'),
      ink: v('--ink-2'),
      fg: v('--foreground'),
      bg: v('--background'),
      mono: v('--font-mono') || "'IBM Plex Mono', ui-monospace, monospace",
      role: Object.fromEntries(ROLES.map((r) => [r, v(`--role-${r}`)])) as Record<Role, string>,
    }
    const clusterColor = new Map(M.topClusters.map((c, k) => [c.id, CAT[k]]))

    // bbox of the whole layout — basis for the fit scale and relative zoom
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity
    for (let i = 0; i < N; i++) {
      bx0 = Math.min(bx0, M.xs[i]); bx1 = Math.max(bx1, M.xs[i])
      by0 = Math.min(by0, M.ys[i]); by1 = Math.max(by1, M.ys[i])
    }
    let W = 0, H = 0, dpr = 1, baseK = 1
    const view = { k: 1, x: 0, y: 0 }
    const X = (i: number) => M.xs[i] * view.k + view.x
    const Y = (i: number) => M.ys[i] * view.k + view.y
    const zs = () => Math.max(0.8, Math.sqrt(view.k / baseK))

    function resize() {
      const w = stage.clientWidth, h = stage.clientHeight
      if (W) { view.x += (w - W) / 2; view.y += (h - H) / 2 } // keep the center on resize
      W = w; H = h
      dpr = Math.min(devicePixelRatio || 1, 2)
      cv.width = W * dpr; cv.height = H * dpr
      baseK = Math.min(W / (bx1 - bx0 + 40), H / (by1 - by0 + 40))
      dirty.current = true
    }
    function fit(ids?: number[]) {
      let x0 = bx0, x1 = bx1, y0 = by0, y1 = by1
      if (ids?.length) {
        x0 = y0 = Infinity; x1 = y1 = -Infinity
        for (const i of ids) {
          x0 = Math.min(x0, M.xs[i]); x1 = Math.max(x1, M.xs[i])
          y0 = Math.min(y0, M.ys[i]); y1 = Math.max(y1, M.ys[i])
        }
      }
      view.k = Math.min(baseK * 12, W / (x1 - x0 + 40), H / (y1 - y0 + 40))
      view.x = W / 2 - (view.k * (x0 + x1)) / 2
      view.y = H / 2 - (view.k * (y0 + y1)) / 2
      dirty.current = true
    }
    function focus(i: number) {
      let r = 0
      for (const e of M.out[i]) r = Math.max(r, Math.hypot(M.xs[M.dst[e]] - M.xs[i], M.ys[M.dst[e]] - M.ys[i]))
      for (const e of M.inn[i]) r = Math.max(r, Math.hypot(M.xs[M.src[e]] - M.xs[i], M.ys[M.src[e]] - M.ys[i]))
      view.k = Math.max(baseK, Math.min(baseK * 12, (Math.min(W, H) * 0.42) / Math.max(r, 20)))
      view.x = W / 2 - M.xs[i] * view.k
      view.y = H / 2 - M.ys[i] * view.k
      dirty.current = true
    }
    cmd.current = { fit, focus }
    resize()
    fit()
    const ro = new ResizeObserver(resize)
    ro.observe(stage)

    // ego set and particle pool are cached per (selection, filter) state
    let egoFor: number | null | undefined, ego: Set<number> | null = null
    let poolKey: unknown = null, poolSel: number | null | undefined, pool: number[] = [], cum = new Float64Array(0)
    const MAXP = 900
    const pe = new Int32Array(MAXP), pt = new Float32Array(MAXP), ps = new Float32Array(MAXP)
    let np = 0
    const pick = () => {
      const r = Math.random() * cum[cum.length - 1]
      let lo = 0, hi = cum.length - 1
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m }
      return pool[lo]
    }

    let hover: number | null = null
    let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null
    let last = performance.now()
    let raf = requestAnimationFrame(frame)

    function frame(now: number) {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const P = p.current
      const animate = P.flow && !reduce
      if (!animate && !dirty.current) return
      dirty.current = false

      const { active, selected: sel } = P
      if (egoFor !== sel) {
        egoFor = sel
        ego = null
        if (sel != null) {
          ego = new Set([sel])
          for (const e of M.out[sel]) ego.add(M.dst[e])
          for (const e of M.inn[sel]) ego.add(M.src[e])
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const k = view.k

      // edges: two batched paths (full / muted), ego edges drawn on top
      ctx.lineWidth = Math.max(0.4, Math.min(1.2, (k / baseK) * 0.6))
      ctx.strokeStyle = C.ink
      for (const bright of [false, true]) {
        ctx.globalAlpha = bright ? 0.09 : 0.025
        ctx.beginPath()
        for (let e = 0; e < M.src.length; e++) {
          const s = M.src[e], d = M.dst[e]
          if (sel != null && (s === sel || d === sel)) continue
          const on = sel == null && active[s] === 1 && active[d] === 1
          if (on !== bright) continue
          ctx.moveTo(X(s), Y(s))
          ctx.lineTo(X(d), Y(d))
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      if (sel != null) {
        ctx.globalAlpha = 0.8
        for (const e of [...M.out[sel], ...M.inn[sel]]) {
          const s = M.src[e], d = M.dst[e]
          const x1 = X(s), y1 = Y(s), x2 = X(d), y2 = Y(d)
          const col = s === sel ? C.gold : IN_BLUE
          ctx.strokeStyle = ctx.fillStyle = col
          ctx.lineWidth = Math.max(0.8, Math.min(4, Math.log10(M.edges[e].sumKzt) - 3.3))
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
          const ang = Math.atan2(y2 - y1, x2 - x1), r = M.rad[d] * zs() + 2
          const ax = x2 - Math.cos(ang) * r, ay = y2 - Math.sin(ang) * r
          ctx.beginPath()
          ctx.moveTo(ax, ay)
          ctx.lineTo(ax - Math.cos(ang - 0.45) * 7, ay - Math.sin(ang - 0.45) * 7)
          ctx.lineTo(ax - Math.cos(ang + 0.45) * 7, ay - Math.sin(ang + 0.45) * 7)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }

      // particles: rate ~ log10(sum); only the selected node's edges when one is selected
      if (animate) {
        if (poolKey !== active || poolSel !== sel) {
          poolKey = active; poolSel = sel; np = 0
          pool = sel != null ? [...M.out[sel], ...M.inn[sel]] : []
          if (sel == null) for (let e = 0; e < M.src.length; e++) if (active[M.src[e]] || active[M.dst[e]]) pool.push(e)
          cum = new Float64Array(pool.length)
          let acc = 0
          pool.forEach((e, j) => { acc += Math.max(0.15, Math.log10(M.edges[e].sumKzt) - 3.4); cum[j] = acc })
        }
        const target = !pool.length ? 0 : sel != null ? Math.min(120, pool.length * 3) : Math.min(MAXP, Math.ceil(pool.length * 0.29))
        while (np < target) { pe[np] = pick(); pt[np] = Math.random(); ps[np] = 0.35 + Math.random() * 0.3; np++ }
        ctx.globalCompositeOperation = 'lighter'
        ctx.strokeStyle = ctx.fillStyle = C.gold
        ctx.lineWidth = 1.2
        ctx.globalAlpha = 0.5
        ctx.beginPath()
        for (let j = 0; j < np; j++) {
          pt[j] += dt * ps[j]
          if (pt[j] >= 1) { pe[j] = pick(); pt[j] = 0 }
          const s = M.src[pe[j]], d = M.dst[pe[j]], t = pt[j], tb = Math.max(0, t - 0.12)
          const x1 = X(s), y1 = Y(s), dx = X(d) - x1, dy = Y(d) - y1
          ctx.moveTo(x1 + dx * tb, y1 + dy * tb)
          ctx.lineTo(x1 + dx * t, y1 + dy * t)
        }
        ctx.stroke()
        ctx.globalAlpha = 0.95
        for (let j = 0; j < np; j++) {
          const s = M.src[pe[j]], d = M.dst[pe[j]], t = pt[j]
          ctx.fillRect(X(s) + (X(d) - X(s)) * t - 1, Y(s) + (Y(d) - Y(s)) * t - 1, 2, 2)
        }
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }

      // nodes
      const z = zs()
      for (let i = 0; i < N; i++) {
        const x = X(i), y = Y(i), r = M.rad[i] * z
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue
        const n = M.nodes[i]
        let a = P.colorBy === 'role' && M.role[i] === 'peripheral' ? 0.45 : 1
        // direct counterparties of the selected node stay visible even if their role is filtered out
        if (!active[i] && !ego?.has(i)) a = 0.1
        if (ego && !ego.has(i)) a *= 0.18
        ctx.globalAlpha = a
        const c =
          P.colorBy === 'role'
            ? C.role[M.role[i]]
            : P.colorBy === 'depth'
              ? depthColor(n.depth)
              : n.cluster != null && clusterColor.has(n.cluster) ? clusterColor.get(n.cluster)! : OTHER
        ctx.beginPath()
        ctx.arc(x, y, P.colorBy === 'depth' && n.depth === M.maxDepth ? Math.max(1.6, r) : r, 0, 6.283)
        if (P.colorBy === 'depth' && n.depth === M.maxDepth) { ctx.strokeStyle = c; ctx.lineWidth = 1.1; ctx.stroke() }
        else { ctx.fillStyle = c; ctx.fill() }
        if (n.isSeed) {
          ctx.strokeStyle = C.fg; ctx.lineWidth = 1
          ctx.beginPath(); ctx.arc(x, y, r + 1.8, 0, 6.283); ctx.stroke()
        }
      }
      ctx.globalAlpha = 1
      for (const [i, col] of [[hover, C.fg], [sel, C.gold]] as const) {
        if (i == null) continue
        ctx.strokeStyle = col; ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(X(i), Y(i), M.rad[i] * z + 4, 0, 6.283); ctx.stroke()
      }

      // labels: top-10 by priority when zoomed in, plus the selection
      const lab = k >= baseK * 1.8 ? [...M.labels] : []
      if (sel != null && !lab.includes(sel)) lab.push(sel)
      ctx.font = `500 11px ${C.mono}`
      ctx.lineWidth = 3
      ctx.strokeStyle = C.bg
      ctx.fillStyle = C.fg
      for (const i of lab) {
        const x = X(i) + M.rad[i] * z + 5, y = Y(i) + 4
        ctx.strokeText(gidTail(M.nodes[i].gid), x, y)
        ctx.fillText(gidTail(M.nodes[i].gid), x, y)
      }
    }

    // interaction; hit-test by brute force (2 248 nodes is cheap)
    function nodeAt(mx: number, my: number) {
      let best: number | null = null, bd = Infinity
      const z = zs()
      for (let i = 0; i < N; i++) {
        const dx = X(i) - mx, dy = Y(i) - my, d = dx * dx + dy * dy, r = M.rad[i] * z + 5
        if (d < r * r && d < bd) { bd = d; best = i }
      }
      return best
    }
    const local = (e: PointerEvent | WheelEvent) => {
      const r = cv.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top] as const
    }
    function showTip(i: number, mx: number, my: number) {
      const n = M.nodes[i]
      tip.innerHTML =
        `<div class="font-mono text-[12px] text-foreground">${esc(gidTail(n.gid))}${n.isSeed ? ' <span class="text-seed">· seed</span>' : ''}</div>` +
        `<div>${ROLE[M.role[i]].label} · приоритет <span class="font-mono tnum">${dec(n.priority)}</span></div>` +
        `<div class="font-mono tnum">вход ${kztShort(n.inKzt)} · выход ${kztShort(n.outKzt)}</div>` +
        `<div class="text-muted-foreground">плательщиков ${num(n.inDeg)} · получателей ${num(n.outDeg)}</div>`
      tip.hidden = false
      const w = tip.offsetWidth, h = tip.offsetHeight
      tip.style.left = `${mx + 14 + w > W ? mx - w - 14 : mx + 14}px`
      tip.style.top = `${my + 14 + h > H ? my - h - 14 : my + 14}px`
    }
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
      cv.setPointerCapture(e.pointerId)
      cv.style.cursor = 'grabbing'
    }
    const onMove = (e: PointerEvent) => {
      const [mx, my] = local(e)
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
        view.x = drag.vx + dx; view.y = drag.vy + dy
        tip.hidden = true
        dirty.current = true
        return
      }
      const h = nodeAt(mx, my)
      if (h !== hover) { hover = h; dirty.current = true }
      cv.style.cursor = h == null ? 'grab' : 'pointer'
      if (h == null) tip.hidden = true
      else showTip(h, mx, my)
    }
    const onUp = (e: PointerEvent) => {
      cv.style.cursor = 'grab'
      if (drag && !drag.moved) {
        const [mx, my] = local(e)
        p.current.onSelect(nodeAt(mx, my))
      }
      drag = null
    }
    const onLeave = () => {
      hover = null
      tip.hidden = true
      dirty.current = true
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [mx, my] = local(e)
      const nk = Math.max(baseK * 0.5, Math.min(baseK * 40, view.k * Math.exp(-e.deltaY * 0.0015)))
      view.x = mx - ((mx - view.x) * nk) / view.k
      view.y = my - ((my - view.y) * nk) / view.k
      view.k = nk
      dirty.current = true
    }
    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('pointerleave', onLeave)
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      cv.removeEventListener('pointerdown', onDown)
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerup', onUp)
      cv.removeEventListener('pointerleave', onLeave)
      cv.removeEventListener('wheel', onWheel)
      cmd.current = null
    }
  }, [model])

  const row = 'flex items-center gap-2'
  const sw = 'inline-block size-2.5 shrink-0 rounded-full'
  return (
    <div
      ref={stageRef}
      className="relative h-[min(78vh,760px)] min-h-[520px] overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 45%, #121a26 0%, var(--background) 70%)' }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Схема сети: ${num(model.nodes.length)} узлов, ${num(model.edges.length)} связей. Текстовая альтернатива — поиск по gid и карточка выбранного узла со списками контрагентов.`}
        className="absolute inset-0 size-full cursor-grab touch-none"
      />
      <div
        ref={tipRef}
        hidden
        className="pointer-events-none absolute z-10 grid max-w-72 gap-0.5 rounded-md border border-line-2 bg-popover/95 px-2.5 py-2 text-xs text-ink-2"
      />
      <div className="absolute bottom-3 left-3 hidden max-w-64 gap-1.5 rounded-lg border bg-background/85 px-3 py-2.5 text-xs text-ink-2 backdrop-blur-sm md:grid">
        {colorBy === 'role' &&
          ROLES.map((r) => (
            <div key={r} className={row}>
              <span className={sw} style={{ background: ROLE[r].color, opacity: r === 'peripheral' ? 0.6 : 1 }} />
              {ROLE[r].label}
            </div>
          ))}
        {colorBy === 'depth' && (
          <>
            <div className={row}><span className={sw} style={{ background: depthColor(0) }} />колено 0 — seed</div>
            {Array.from({ length: Math.max(0, model.maxDepth - 1) }, (_, k) => k + 1).map((d) => (
              <div key={d} className={row}><span className={sw} style={{ background: depthColor(d) }} />колено {d}</div>
            ))}
            <div className={row}><span className={`${sw} border-[1.5px]`} style={{ borderColor: depthColor(model.maxDepth) }} />колено {model.maxDepth} — обход остановлен</div>
          </>
        )}
        {colorBy === 'cluster' && (
          <>
            {model.topClusters.map((c, k) => (
              <div key={c.id} className={row}>
                <span className={sw} style={{ background: CAT[k] }} />
                кластер #{c.id} · <span className="font-mono tnum">{num(c.n)}</span> узл.
              </div>
            ))}
            <div className={row}><span className={sw} style={{ background: OTHER }} />остальные кластеры</div>
          </>
        )}
        <div className={row}><span className={`${sw} ring-1 ring-foreground ring-offset-1 ring-offset-background`} />seed — белое кольцо</div>
        {selected != null ? (
          <>
            <div className={row}><span className="h-0.5 w-3.5 shrink-0 rounded-full bg-gold" />исходящие переводы</div>
            <div className={row}><span className="h-0.5 w-3.5 shrink-0 rounded-full" style={{ background: IN_BLUE }} />входящие переводы</div>
          </>
        ) : (
          flow && <div className={row}><span className="h-0.5 w-3.5 shrink-0 rounded-full bg-gold" />поток денег, частота ~ сумма</div>
        )}
      </div>
    </div>
  )
}
