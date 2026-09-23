import { resolve } from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import type { Edge, Node, Transaction } from "./types";

const dataDir = process.env.DATA_DIR ?? resolve(import.meta.dir, "../../../task/data");

// Files are ZSTD-compressed; hyparquet core only ships Snappy, Bun has zstd built in.
const compressors = { ZSTD: (input: Uint8Array) => new Uint8Array(Bun.zstdDecompressSync(input)) };

async function read(name: string): Promise<Record<string, any>[]> {
  const file = await asyncBufferFromFile(resolve(dataDir, `${name}.parquet`));
  return parquetReadObjects({ file, compressors });
}

// int64 columns come back as BigInt — gids exceed MAX_SAFE_INTEGER, so stringify, never Number().
export const nodes: Node[] = (await read("nodes")).map((r) => ({
  gid: String(r.gid),
  depth: Number(r.depth),
  isSeed: r.is_seed,
}));

export const edges: Edge[] = (await read("edges")).map((r) => ({
  src: String(r.src),
  dst: String(r.dst),
  sumKzt: r.sum_kzt,
  nTx: Number(r.n_tx),
  depth: r.depth,
}));

// DATE column decodes to a JS Date at UTC midnight.
export const transactions: Transaction[] = (await read("transactions")).map((r) => ({
  src: String(r.src),
  dst: String(r.dst),
  date: (r.date as Date).toISOString().slice(0, 10),
  sumKzt: r.sum_kzt,
}));
