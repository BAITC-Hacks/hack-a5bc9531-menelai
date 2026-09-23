import { createBrowserRouter, Navigate } from 'react-router'
import AppLayout from '@/layouts/AppLayout'
import SectionLayout from '@/layouts/SectionLayout'
import AnomaliesPage from '@/pages/AnomaliesPage'
import ArchitecturePage from '@/pages/ArchitecturePage'
import AssistantPage from '@/pages/AssistantPage'
import ClustersPage from '@/pages/ClustersPage'
import CompletenessPage from '@/pages/CompletenessPage'
import GraphPage from '@/pages/GraphPage'
import NodePage from '@/pages/NodePage'
import NotFoundPage from '@/pages/NotFoundPage'
import OverviewPage from '@/pages/OverviewPage'
import ResiliencePage from '@/pages/ResiliencePage'
import RoutesPage from '@/pages/RoutesPage'
import RulesPage from '@/pages/RulesPage'
import TimePage from '@/pages/TimePage'
import TopPage from '@/pages/TopPage'
import UploadPage from '@/pages/UploadPage'

const ANALYSIS = [
  { to: '/analysis/routes', label: 'Маршруты и циклы' },
  { to: '/analysis/time', label: 'Время' },
  { to: '/analysis/anomalies', label: 'Аномалии' },
  { to: '/analysis/resilience', label: 'Устойчивость' },
  { to: '/analysis/completeness', label: 'Полнота данных' },
]
const METHOD = [
  { to: '/method/rules', label: 'Правила ролей' },
  { to: '/method/architecture', label: 'Схема решения' },
]

export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppLayout,
    children: [
      { index: true, Component: OverviewPage },
      { path: 'graph', Component: GraphPage },
      { path: 'nodes/:gid', Component: NodePage },
      { path: 'top', Component: TopPage },
      { path: 'clusters', Component: ClustersPage },
      {
        path: 'analysis',
        element: <SectionLayout label="анализ" tabs={ANALYSIS} />,
        children: [
          { index: true, element: <Navigate to="routes" replace /> },
          { path: 'routes', Component: RoutesPage },
          { path: 'time', Component: TimePage },
          { path: 'anomalies', Component: AnomaliesPage },
          { path: 'resilience', Component: ResiliencePage },
          { path: 'completeness', Component: CompletenessPage },
        ],
      },
      { path: 'assistant', Component: AssistantPage },
      { path: 'upload', Component: UploadPage },
      {
        path: 'method',
        element: <SectionLayout label="метод" tabs={METHOD} />,
        children: [
          { index: true, element: <Navigate to="rules" replace /> },
          { path: 'rules', Component: RulesPage },
          { path: 'architecture', Component: ArchitecturePage },
        ],
      },
      { path: 'rules', element: <Navigate to="/method/rules" replace /> },
      { path: '*', Component: NotFoundPage },
    ],
  },
])
