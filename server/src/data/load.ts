import { resolve } from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import type { Edge, Node, Transaction } from "./types";

// Files are ZSTD-compressed; hyparquet core only ships Snappy, Bun has zstd built in.
const compressors = { ZSTD: (input: Uint8Array) => new Uint8Array(Bun.zstdDecompressSync(input)) };

async function read(dataDir: string, name: string): Promise<Record<string, any>[]> {
  const file = await asyncBufferFromFile(resolve(dataDir, `${name}.parquet`));
  return parquetReadObjects({ file, compressors });
}

// DATE decodes to a JS Date at UTC midnight; a string date column is taken as "YYYY-MM-DD[ ...]".
const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

// int64 columns come back as BigInt — gids exceed MAX_SAFE_INTEGER, so stringify, never Number().
export async function readTables(dataDir: string): Promise<{ nodes: Node[]; edges: Edge[]; transactions: Transaction[] }> {
  const nodes = (await read(dataDir, "nodes")).map((r) => ({ gid: String(r.gid), depth: Number(r.depth), isSeed: Boolean(r.is_seed) }));
  const edges = (await read(dataDir, "edges")).map((r) => ({
    src: String(r.src), dst: String(r.dst), sumKzt: Number(r.sum_kzt), nTx: Number(r.n_tx), depth: Number(r.depth),
  }));
  const transactions = (await read(dataDir, "transactions")).map((r) => ({
    src: String(r.src), dst: String(r.dst), date: day(r.date), sumKzt: Number(r.sum_kzt),
  }));
  return { nodes, edges, transactions };
}
