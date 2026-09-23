export type Node = { gid: string; depth: number; isSeed: boolean };
export type Edge = { src: string; dst: string; sumKzt: number; nTx: number; depth: number };
export type Transaction = { src: string; dst: string; date: string; sumKzt: number };
