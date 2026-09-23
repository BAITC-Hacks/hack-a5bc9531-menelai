import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function NotFoundPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Страница не найдена</CardTitle>
        <CardDescription>Такого адреса нет.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button nativeButton={false} render={<Link to="/" />}>На главную</Button>
      </CardContent>
    </Card>
  )
}
