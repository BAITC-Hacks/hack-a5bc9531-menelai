// gids exceed Number.MAX_SAFE_INTEGER — always keep them as strings.
export type Gid = string

export const ROLES = ['coordinator', 'consolidator', 'distributor', 'transit', 'terminal', 'peripheral'] as const
export type Role = (typeof ROLES)[number]

export type Stats = {
  nodes: number
  edges: number
  transactions: number
  seeds: number
  totalKzt: number
  period: [string, string]
  /** node count per crawl hop 0..4 */
  byDepth: number[]
  /** null until pipeline/run.py has produced out/ */
  roles: Record<Role, number> | null
  clusters: number | null
}

export type GraphNode = {
  gid: Gid
  depth: number
  isSeed: boolean
}

/** Graph node with layout coordinates and pipeline results (null when out/ is missing). */
export type LaidOutNode = GraphNode & {
  x: number
  y: number
  role: Role | null
  priority: number | null
  cluster: number | null
  inDeg: number
  outDeg: number
  inKzt: number
  outKzt: number
}

export type Edge = {
  src: Gid
  dst: Gid
  sumKzt: number
  nTx: number
  depth: number
}

export type Graph = {
  nodes: LaidOutNode[]
  edges: Edge[]
}

export type Link = { gid: Gid; sum_kzt: number; n_tx: number }

/** One node of out/node_metrics.json, as written by the pipeline (snake_case kept on purpose). */
export type Metrics = {
  in_deg: number
  out_deg: number
  in_kzt: number
  out_kzt: number
  in_tx: number
  out_tx: number
  pass_through: number | null
  seed_share: number
  seed_money_in: number
  n_seed_upstream: number
  betweenness: number
  pagerank: number
  in_cycle: boolean
  fast_out_share: number | null
  sync_in_events: number
  truncated: boolean
  depth: number
  is_seed: boolean
  role: Role
  role_score: number
  priority_score: number
  cluster_id: number
  evidence: string
  /** pipeline v2: structural role, but low share of seed money */
  weak_seed_link?: boolean
  cycles: Gid[][]
  sync_days: string[]
  top_in: Link[]
  top_out: Link[]
}

export type NodeDetails = {
  node: GraphNode
  metrics: Metrics | null
  in: Edge[]
  out: Edge[]
}

export type TopRow = {
  rank: number
  gid: Gid
  role: Role
  priorityScore: number
  why: string
  roleScore: number
  clusterId: number
  isSeed: boolean
  depth: number
  inKzt: number
  outKzt: number
  evidence: string
}

export type Cluster = {
  clusterId: number
  nNodes: number
  nSeed: number
  sumKztInternal: number
  topGids: Gid[]
  hypothesis: string
  roles: Partial<Record<Role, number>>
}

export type Meta = {
  rules: string
  thresholds: Record<string, number>
  role_weight: Record<Role, number>
  role_counts: Record<Role, number>
}

export const CSV_FILES = ['nodes_roles.csv', 'clusters.csv', 'top_nodes.csv'] as const

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => get<{ ok: true }>('/health'),
  stats: () => get<Stats>('/stats'),
  graph: () => get<Graph>('/graph'),
  node: (gid: Gid) => get<NodeDetails>(`/nodes/${encodeURIComponent(gid)}`),
  top: () => get<TopRow[]>('/top'),
  clusters: () => get<Cluster[]>('/clusters'),
  meta: () => get<Meta>('/meta'),
  exportUrl: (file: (typeof CSV_FILES)[number]) => `/api/export/${file}`,
}
