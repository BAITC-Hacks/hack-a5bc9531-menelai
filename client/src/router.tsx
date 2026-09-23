import { createBrowserRouter } from 'react-router'
import AppLayout from '@/layouts/AppLayout'
import ClustersPage from '@/pages/ClustersPage'
import GraphPage from '@/pages/GraphPage'
import NodePage from '@/pages/NodePage'
import NotFoundPage from '@/pages/NotFoundPage'
import OverviewPage from '@/pages/OverviewPage'
import RulesPage from '@/pages/RulesPage'
import TopPage from '@/pages/TopPage'

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
      { path: 'rules', Component: RulesPage },
      { path: '*', Component: NotFoundPage },
    ],
  },
])
