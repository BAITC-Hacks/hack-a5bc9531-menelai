// gids exceed Number.MAX_SAFE_INTEGER — always keep them as strings.
export type Gid = string

export type Stats = {
  nodes: number
  edges: number
  transactions: number
  seeds: number
  totalKzt: number
}

export type Role = 'consolidator' | 'transit' | 'distributor' | 'terminal' | 'coordinator' | 'peripheral'

export type GraphNode = {
  gid: Gid
  depth: number
  isSeed: boolean
  role: Role
  roleScore: number
  clusterId: number
  priorityScore: number
  inKzt: number
  outKzt: number
  inDeg: number
  outDeg: number
}

export type Edge = {
  src: Gid
  dst: Gid
  sumKzt: number
  nTx: number
  depth: number
}

export type Graph = {
  nodes: GraphNode[]
  edges: Edge[]
}

export type NodeMetrics = {
  gid: Gid
  depth: number
  isSeed: boolean
  inDeg: number
  outDeg: number
  inKzt: number
  outKzt: number
  inTx: number
  outTx: number
  nCounterparties: number
  firstDate: string
  lastDate: string
  activeDays: number
  passThrough: number | null
  truncatedByDepth: boolean
  realSink: boolean
  noEdges: boolean
  pagerank: number
  betweenness: number
  component: number
  componentSize: number
  inCycle: boolean
  sameDayBursts: number
  avgInTx: number | null
  avgOutTx: number | null
  seedMoneyIn: number
  seedShare: number
  clusterId: number
}

export type NodeRoleInfo = {
  role: Role
  roleScore: number
  roleRule: string
  evidence: string
  priorityScore: number
}

export type DailyFlow = { date: string; inKzt: number; outKzt: number; inTx: number; outTx: number }

export type NodeDetails = {
  node: GraphNode
  metrics: NodeMetrics
  role: NodeRoleInfo
  in: Edge[]
  out: Edge[]
  daily: DailyFlow[]
}

export type TopNode = { rank: number; gid: Gid; role: Role; priorityScore: number; why: string }

export type Cluster = {
  clusterId: number
  nNodes: number
  nSeed: number
  sumKztInternal: number
  topGids: Gid[]
  hypothesis: string
}

export type ClusterDetails = Cluster & { members: GraphNode[] }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const api = {
  health: () => get<{ ok: true }>('/health'),
  stats: () => get<Stats>('/stats'),
  graph: () => get<Graph>('/graph'),
  node: (gid: Gid) => get<NodeDetails>(`/nodes/${encodeURIComponent(gid)}`),
  top: () => get<TopNode[]>('/top'),
  clusters: () => get<Cluster[]>('/clusters'),
  cluster: (id: number) => get<ClusterDetails>(`/clusters/${id}`),
}
