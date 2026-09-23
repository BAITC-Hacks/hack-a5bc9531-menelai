export type Node = { gid: string; depth: number; isSeed: boolean };
export type Edge = { src: string; dst: string; sumKzt: number; nTx: number; depth: number };
export type Transaction = { src: string; dst: string; date: string; sumKzt: number };

// Pipeline outputs from out/*.csv (see docs/PIPELINE_CONTRACT.md).
export type Role = "consolidator" | "transit" | "distributor" | "terminal" | "coordinator" | "peripheral";

export type NodeRole = {
  gid: string;
  role: Role;
  roleScore: number;
  clusterId: number;
  priorityScore: number;
  evidence: string;
  roleRule: string;
};

export type Cluster = {
  clusterId: number;
  nNodes: number;
  nSeed: number;
  sumKztInternal: number;
  topGids: string[];
  hypothesis: string;
};

export type TopNode = { rank: number; gid: string; role: Role; priorityScore: number; why: string };

export type NodeMetrics = {
  gid: string;
  depth: number;
  isSeed: boolean;
  inDeg: number;
  outDeg: number;
  inKzt: number;
  outKzt: number;
  inTx: number;
  outTx: number;
  nCounterparties: number;
  firstDate: string;
  lastDate: string;
  activeDays: number;
  passThrough: number | null;
  truncatedByDepth: boolean;
  realSink: boolean;
  noEdges: boolean;
  pagerank: number;
  betweenness: number;
  component: number;
  componentSize: number;
  inCycle: boolean;
  sameDayBursts: number;
  avgInTx: number | null;
  avgOutTx: number | null;
  seedMoneyIn: number;
  seedShare: number;
  clusterId: number;
};

export type EdgeMetrics = {
  src: string;
  dst: string;
  sumKzt: number;
  nTx: number;
  depth: number;
  srcDepth: number;
  dstDepth: number;
  minTx: number;
  maxTx: number;
  firstDate: string;
  lastDate: string;
  activeDays: number;
  mutual: boolean;
  backEdge: boolean;
};

export type GraphNode = Node &
  Pick<NodeRole, "role" | "roleScore" | "clusterId" | "priorityScore"> &
  Pick<NodeMetrics, "inKzt" | "outKzt" | "inDeg" | "outDeg">;
