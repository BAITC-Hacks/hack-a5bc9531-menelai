// gids exceed Number.MAX_SAFE_INTEGER — always keep them as strings.
export type Gid = string

export const ROLES = ['coordinator', 'consolidator', 'distributor', 'transit', 'terminal', 'peripheral'] as const
export type Role = (typeof ROLES)[number]

export type Stats = {
  datasetId: string
  datasetName: string
  /** last crawl hop; nodes there have no outgoing edges because the crawl stopped */
  maxDepth: number
  /** smallest transfer amount present in the export */
  minTxKzt: number | null
  nodes: number
  edges: number
  transactions: number
  seeds: number
  totalKzt: number
  period: [string, string] | null
  /** node count per crawl hop 0..maxDepth */
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

// ---------------------------------------------------------------- /api/analytics (server/src/data/analytics.ts)

export type TimeAnalytics = {
  daily: { date: string; n: number; kzt: number }[]
  syncTotal: number
  sync: { date: string; dst: Gid; role: Role | null; payers: number; kzt: number }[]
  syncPayers: number
  fastDays: number
  fastTransit: { gid: Gid; inKzt: number; outKzt: number; passThrough: number | null; fastShare: number | null; seedUp: number; depth: number }[]
}

export type Cycle = { path: Gid[]; minKzt: number }
export type RoutesAnalytics = {
  windowDays: number
  chainsTotal: number
  chains: { a: Gid; b: Gid; c: Gid; hits: number; bRole: Role | null; abKzt: number; abN: number; bcKzt: number; bcN: number }[]
  cyclesTotal: number
  cycleMaxLen: number
  byLen: Record<string, number>
  mutual: Cycle[]
  triangles: Cycle[]
}

export type AnomaliesAnalytics = {
  profile: { gid: Gid; depth: number; inKzt: number; depthMedian: number; z: number; role: Role; inDeg: number; outDeg: number; passThrough: number | null }[]
}

export type ResiliencePoint = { N: number; components: number; largestNodes: number; largestShare: number; removedShare: number }

export type CompletenessAnalytics = {
  seedNoOut: number
  truncated: number
  orphans: number
  pContinue: Record<'1' | '2' | '3+', { share: number; n: number }>
  truncatedByIn: Record<'1' | '2' | '3+', number>
  expectedContinue: number
  transitToTruncated: number
  consolidators: number
}

// ---------------------------------------------------------------- /api/assistant

export type AssistantStatus = { llm: boolean; model: string; tools: string[] }
export type AssistantStep = { tool: string; args: unknown; ok: boolean; summary: string }
export type AssistantAnswer = { answer: string; trace: AssistantStep[]; model: string }

// ---------------------------------------------------------------- /api/datasets

export type DatasetInfo = {
  id: string
  name: string
  source: 'bundled' | 'upload'
  createdAt: string
  nodes: number
  edges: number
  transactions: number
  seeds: number
  maxDepth: number
  period: [string, string] | null
  roles: Record<Role, number> | null
}
export type Datasets = { active: string; datasets: DatasetInfo[] }

/** Upload failure: server message (Russian, shown verbatim) plus the pipeline log tail when present. */
export class UploadError extends Error {
  log?: string
  constructor(message: string, log?: string) {
    super(message)
    this.log = log
  }
}

export const CSV_FILES = ['nodes_roles.csv', 'clusters.csv', 'top_nodes.csv'] as const

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
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
  time: () => get<TimeAnalytics>('/analytics/time'),
  routes: () => get<RoutesAnalytics>('/analytics/routes'),
  anomalies: () => get<AnomaliesAnalytics>('/analytics/anomalies'),
  resilience: () => get<ResiliencePoint[]>('/analytics/resilience'),
  completeness: () => get<CompletenessAnalytics>('/analytics/completeness'),
  assistantStatus: () => get<AssistantStatus>('/assistant/status'),
  /** Deterministic tool call (works without an LLM key). */
  tool: <T = unknown>(name: string, args: Record<string, unknown>) =>
    get<T>(`/assistant/tools/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) }),
  ask: (question: string) =>
    get<AssistantAnswer>('/assistant/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) }),
  datasets: () => get<Datasets>('/datasets'),
  /** FormData: files nodes, edges, transactions (.parquet), optional name. The new dataset becomes active. */
  uploadDataset: async (form: FormData) => {
    const res = await fetch('/api/datasets', { method: 'POST', body: form })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new UploadError(body?.error ?? `${res.status} ${res.statusText}`, body?.log)
    return body as { dataset: DatasetInfo; log: string }
  },
  activateDataset: (id: string) => get<{ active: string }>(`/datasets/${encodeURIComponent(id)}/activate`, { method: 'POST' }),
  deleteDataset: (id: string) => get<{ active: string }>(`/datasets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  exportUrl: (file: (typeof CSV_FILES)[number]) => `/api/export/${file}`,
}

/** Every other endpoint serves the active dataset, so a switch reloads the whole app at `to`. */
export async function switchDataset(id: string, to = '/') {
  await api.activateDataset(id)
  window.location.assign(to)
}
