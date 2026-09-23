import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { api, type NodeDetails } from '@/lib/api'

export default function NodePage() {
  const { gid = '' } = useParams()
  const [data, setData] = useState<NodeDetails | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setData(null)
    setError(null)
    api
      .node(gid)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [gid])

  useEffect(load, [load])

  if (error) {
    const notFound = error.startsWith('404')
    return (
      <Card>
        <CardHeader>
          <CardTitle>{notFound ? 'Узел не найден' : 'Ошибка загрузки узла'}</CardTitle>
          <CardDescription>
            {notFound ? `Узла с GID ${gid} нет в графе.` : `Не удалось загрузить узел ${gid} (${error}).`}
          </CardDescription>
        </CardHeader>
        {!notFound && (
          <CardContent>
            <Button onClick={load}>Повторить</Button>
          </CardContent>
        )}
      </Card>
    )
  }

  const items = [
    { label: 'Глубина', value: data?.node.depth },
    { label: 'Входящие связи', value: data?.in.length },
    { label: 'Исходящие связи', value: data?.out.length },
  ]

  return (
    <>
      <div className="flex items-center gap-3">
        <h2 className="font-mono text-lg font-semibold">{gid}</h2>
        {data?.node.isSeed && <Badge>Исходный узел</Badge>}
        {!data && <Badge variant="outline">Загрузка…</Badge>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {items.map(({ label, value }) => (
          <Card key={label}>
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{value ?? '—'}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
    </>
  )
}
