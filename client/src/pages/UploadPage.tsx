import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { CheckIcon, FileUpIcon, Loader2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader, Panel, RoleChip, RoleStackBar, StatStrip } from '@/components/kit'
import { api, ROLES, switchDataset, UploadError, type DatasetInfo } from '@/lib/api'
import { num, periodLabel, plural } from '@/lib/format'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

const FILES = [
  { key: 'nodes', cols: 'gid, depth, is_seed' },
  { key: 'edges', cols: 'src, dst, sum_kzt, n_tx, depth' },
  { key: 'transactions', cols: 'src, dst, date, sum_kzt' },
] as const
type FileKey = (typeof FILES)[number]['key']

/** Dataset name: upload time on the analyst's clock, dd.mm.yy hh:mm */
const localStamp = () => {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${two(d.getFullYear() % 100)} ${two(d.getHours())}:${two(d.getMinutes())}`
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const LOG_KEY = 'upload-log'

export default function UploadPage() {
  const [files, setFiles] = useState<Partial<Record<FileKey, File>>>({})
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<{ message: string; log?: string } | null>(null)
  const list = useApi(api.datasets)
  // After a successful upload the page reloads at ?done=<id> so the header and footer pick up the new dataset.
  const [params] = useSearchParams()
  const done = params.get('done')
  const doneDataset = done ? list.data?.datasets.find((d) => d.id === done) : undefined
  const [doneLog] = useState(() => (done ? sessionStorage.getItem(LOG_KEY) : null) ?? '')
  useEffect(() => {
    if (doneDataset) toast.success(`Выгрузка «${doneDataset.name}» рассчитана и активна`, { id: 'upload-done' })
  }, [doneDataset])

  const ready = FILES.every((f) => files[f.key])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready || running) return
    const form = new FormData()
    for (const f of FILES) form.append(f.key, files[f.key]!)
    form.append('name', localStamp())
    setRunning(true)
    setFailure(null)
    try {
      const { dataset, log } = await api.uploadDataset(form)
      sessionStorage.setItem(LOG_KEY, log)
      window.location.assign(`/upload?done=${encodeURIComponent(dataset.id)}`)
    } catch (err) {
      setFailure({ message: errText(err), log: err instanceof UploadError ? err.log : undefined })
      toast.error('Выгрузку не удалось обработать', { description: errText(err), duration: 10000 })
      setRunning(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="данные · новая выписка"
        title="Загрузить выписку"
        lede={
          <>
            Три файла .parquet: nodes, edges, transactions — выгрузка переводов в том же формате, что и демо. После загрузки пайплайн посчитает роли, кластеры и
            приоритет, и все экраны переключатся на новую выгрузку.
          </>
        }
      />

      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-2">
          {FILES.map((f) => (
            <FileRow key={f.key} label={f.key} cols={f.cols} file={files[f.key]} onFile={(file) => setFiles((prev) => ({ ...prev, [f.key]: file }))} />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" className="min-h-11" disabled={!ready || running}>
            Рассчитать роли
          </Button>
          {running && (
            <span className="flex items-center gap-2 text-sm text-ink-2">
              <Loader2Icon className="size-4 animate-spin" aria-hidden /> Пайплайн считает…
            </span>
          )}
        </div>
      </form>

      {failure && (
        <Panel eyebrow="ошибка" title="Выгрузку не удалось обработать">
          <p className="text-sm whitespace-pre-wrap text-destructive">{failure.message}</p>
          {failure.log && <LogBlock log={failure.log} open />}
        </Panel>
      )}

      {doneDataset && <ResultPanel dataset={doneDataset} log={doneLog} />}

      <Panel eyebrow="все выгрузки" title="Загруженные выгрузки">
        {!list.data ? (
          <p className="text-sm text-ink-2">{list.error ?? 'Загрузка…'}</p>
        ) : (
          <ul className="grid gap-2">
            {list.data.datasets.map((d) => (
              <DatasetRow key={d.id} dataset={d} active={d.id === list.data!.active} onDeleted={list.reload} />
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}

function FileRow({ label, cols, file, onFile }: { label: string; cols: string; file?: File; onFile: (file: File | undefined) => void }) {
  const [dragOver, setDragOver] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (!dropped) return
    if (!dropped.name.toLowerCase().endsWith('.parquet')) {
      toast.error('Нужен файл .parquet', { description: dropped.name })
      return
    }
    onFile(dropped)
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => picker.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.current?.click() }
      }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-dashed bg-card px-4 py-3 transition-colors',
        dragOver ? 'border-gold bg-gold/5' : file ? 'border-solid border-gold/50' : 'hover:border-gold/60',
      )}
    >
      {file ? <CheckIcon className="size-4 shrink-0 text-gold" aria-hidden /> : <FileUpIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="w-28 font-mono text-[13px] font-medium">{label}</span>
      <span className="font-mono text-[12px] text-ink-2">{cols}</span>
      <span className="ml-auto flex min-w-0 items-center gap-2 text-[13px]">
        {file ? (
          <>
            <span className="truncate font-mono text-[12px]">{file.name}</span>
            <button
              type="button"
              aria-label={`Убрать ${label}`}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onFile(undefined) }}
            >
              <XIcon className="size-3.5" aria-hidden />
            </button>
          </>
        ) : (
          <span className="text-muted-foreground">Перетащите .parquet или нажмите</span>
        )}
      </span>
      <input
        ref={picker}
        type="file"
        accept=".parquet"
        className="hidden"
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }}
      />
    </div>
  )
}

function LogBlock({ log, open }: { log: string; open?: boolean }) {
  return (
    <details open={open} className="mt-3">
      <summary className="cursor-pointer text-xs text-muted-foreground">Лог пайплайна</summary>
      <pre className="mt-2 max-h-72 overflow-auto rounded-lg border bg-panel-2/60 p-3 font-mono text-[11.5px] whitespace-pre-wrap text-ink-2">{log}</pre>
    </details>
  )
}

function ResultPanel({ dataset: d, log }: { dataset: DatasetInfo; log: string }) {
  return (
    <Panel eyebrow="готово · выгрузка активна" title={d.name}>
      <div className="grid gap-4">
        <StatStrip
          items={[
            { value: num(d.nodes), label: 'узлов' },
            { value: num(d.edges), label: 'пар плательщик → получатель' },
            { value: num(d.transactions), label: 'переводов' },
            { value: num(d.seeds), label: 'seed', tone: 'var(--seed)' },
            { value: d.maxDepth, label: 'колен обхода' },
            { value: d.period ? periodLabel(d.period) : '—', label: 'период' },
          ]}
        />
        {d.roles && (
          <div className="grid gap-2">
            <RoleStackBar counts={d.roles} />
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <span key={r} className="flex items-center gap-1.5">
                  <RoleChip role={r} />
                  <span className="font-mono text-[12px] tnum">{num(d.roles![r])}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {/* full navigation: pages mounted before the upload hold data of the previous dataset */}
          <Button nativeButton={false} render={<a href="/" />}>
            Открыть обзор
          </Button>
          <Button variant="outline" nativeButton={false} render={<a href="/graph" />}>
            Схема сети
          </Button>
          <Button variant="outline" nativeButton={false} render={<a href="/top" />}>
            Приоритеты
          </Button>
        </div>
        {log && <LogBlock log={log} />}
      </div>
    </Panel>
  )
}

function DatasetRow({ dataset: d, active, onDeleted }: { dataset: DatasetInfo; active: boolean; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onDelete = async () => {
    if (!confirm) return setConfirm(true)
    try {
      await api.deleteDataset(d.id)
      if (active) window.location.assign('/upload')
      else onDeleted()
    } catch (e) {
      setError(errText(e))
      setConfirm(false)
    }
  }
  return (
    <li className={cn('flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-2.5', active ? 'border-gold/50 bg-gold/5' : 'bg-panel-2/40')}>
      <div className="grid min-w-0 gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-medium">{d.name}</span>
          <Badge variant="outline">{d.source === 'bundled' ? 'демо' : 'загрузка'}</Badge>
          {active && <span className="font-mono text-[11px] text-gold uppercase">активна</span>}
        </span>
        <span className="font-mono text-[12px] text-muted-foreground tnum">
          {num(d.nodes)} узлов · {num(d.edges)} связей · {num(d.transactions)} переводов · {num(d.seeds)} seed · {d.maxDepth} {plural(d.maxDepth, 'колено', 'колена', 'колен')}
          {d.period ? ` · ${periodLabel(d.period)}` : ''}
        </span>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
      <div className="ml-auto flex gap-2">
        {!active && (
          <Button size="sm" variant="outline" onClick={() => switchDataset(d.id).catch((e: unknown) => setError(errText(e)))}>
            Открыть
          </Button>
        )}
        {active && (
          <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/" />}>
            Обзор
          </Button>
        )}
        {d.source === 'upload' && (
          <Button size="sm" variant={confirm ? 'destructive' : 'ghost'} onClick={onDelete} onBlur={() => setConfirm(false)}>
            {confirm ? 'Точно удалить?' : 'Удалить'}
          </Button>
        )}
      </div>
    </li>
  )
}
