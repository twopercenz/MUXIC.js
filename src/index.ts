import type { AudioStreamResult, Engine, EngineOpenOptions, Resolver } from "./types.js";
import { youtubeResolver } from "./resolvers/youtube.js";
import { ytdlpFfmpegEngine } from "./engines/ytdlp-ffmpeg.js";

const resolvers: Resolver[] = [youtubeResolver];
const engines = new Map<string, Engine>([["ytdlp-ffmpeg", ytdlpFfmpegEngine]]);

/** Add support for another site: { test(url) => bool, resolve(url) => { site, id } } */
export function registerResolver(resolver: Resolver): void {
  resolvers.push(resolver);
}

/** Add (or replace) a named engine. See src/engines/ for the shape. */
export function registerEngine(name: string, engine: Engine): void {
  engines.set(name, engine);
}

export interface OpenAudioStreamOptions extends EngineOpenOptions {
  /** Which registered engine to use. Default "ytdlp-ffmpeg". */
  engine?: string;
}

/** Resolves `input` with the first matching resolver, then opens it with
 *  the named engine (default "ytdlp-ffmpeg"). */
export async function openAudioStream(input: string, opts: OpenAudioStreamOptions = {}): Promise<AudioStreamResult> {
  const resolver = resolvers.find((r) => r.test(input));
  if (!resolver) throw new Error(`No resolver registered for: ${input}`);
  const id = resolver.resolve(input);

  const engineName = opts.engine ?? "ytdlp-ffmpeg";
  const engine = engines.get(engineName);
  if (!engine) throw new Error(`No engine registered as "${engineName}"`);

  return engine.open(id, opts);
}

export { ExtractionError, TooManyExtractionsError, classifyYtDlpError } from "./errors.js";
export type { ExtractionErrorCode } from "./errors.js";
export { createSlots } from "./concurrency.js";
export type { Slots } from "./concurrency.js";
// Not registered under a name by default — see src/engines/innertube.ts for why.
// Opt in with: registerEngine("innertube", innertubeEngine)
export { innertubeEngine } from "./engines/innertube.js";
export type { AudioStreamResult, Engine, EngineOpenOptions, Resolver, ResolvedId } from "./types.js";
