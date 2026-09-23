// gids exceed Number.MAX_SAFE_INTEGER — always keep them as strings.
export type Gid = string

export type Stats = {
  nodes: number
  edges: number
  transactions: number
  seeds: number
  totalKzt: number
}

export type GraphNode = {
  gid: Gid
  depth: number
  isSeed: boolean
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

export type NodeDetails = {
  node: GraphNode
  in: Edge[]
  out: Edge[]
}

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
}
