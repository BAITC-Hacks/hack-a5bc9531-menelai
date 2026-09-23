import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { api, type Stats } from '@/lib/api'

const nf = new Intl.NumberFormat('ru-RU')
const kzt = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'KZT',
  maximumFractionDigits: 0,
})

const STAT_ITEMS: { key: keyof Stats; label: string; format: (n: number) => string }[] = [
  { key: 'nodes', label: 'Узлы', format: nf.format },
  { key: 'edges', label: 'Связи', format: nf.format },
  { key: 'transactions', label: 'Транзакции', format: nf.format },
  { key: 'seeds', label: 'Исходные узлы', format: nf.format },
  { key: 'totalKzt', label: 'Общая сумма', format: kzt.format },
]

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    api
      .stats()
      .then(setStats)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(load, [load])

  return (
    <>
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Обзор</h2>
        {error ? (
          <Badge variant="destructive">API недоступен</Badge>
        ) : stats ? (
          <Badge variant="secondary">API подключен</Badge>
        ) : (
          <Badge variant="outline">Загрузка…</Badge>
        )}
      </div>
      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>Не удалось подключиться к API</CardTitle>
            <CardDescription>
              Сервер на порту 3001 не отвечает ({error}). Проверьте, что он запущен.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={load}>Повторить</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {STAT_ITEMS.map(({ key, label, format }) => (
            <Card key={key}>
              <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {stats ? format(stats[key]) : '—'}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
