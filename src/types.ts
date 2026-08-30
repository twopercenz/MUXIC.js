/** A URL resolved down to a site + that site's own identifier. */
export interface ResolvedId {
  site: string;
  id: string;
}

/** URL → ResolvedId. Pure — no network, no process spawning. */
export interface Resolver {
  test(url: string): boolean;
  resolve(url: string): ResolvedId;
}

export interface EngineOpenOptions {
  signal?: AbortSignal;
  [key: string]: unknown;
}

export interface AudioStreamResult {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  /** Kills whatever's still running (process, in-flight fetch) and frees
   *  any concurrency slot the engine took. Safe to call more than once. */
  abort: () => void;
}

/** ResolvedId → bytes. All the side effects (spawning, fetching) live here. */
export interface Engine {
  open(id: ResolvedId, opts?: EngineOpenOptions): Promise<AudioStreamResult>;
}
