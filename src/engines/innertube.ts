import type { AudioStreamResult, Engine, EngineOpenOptions, ResolvedId } from "../types.js";
import { ExtractionError } from "../errors.js";

export interface InnertubeOptions extends EngineOpenOptions {
  /** Client identities to try in order. Default ["IOS", "ANDROID"]. */
  clients?: string[];
}

/**
 * Optional fast-path: gets a direct googlevideo URL via `youtubei.js`
 * instead of spawning yt-dlp — no process, no transcode. NOT the default
 * engine, and not registered under that name; opt in explicitly via
 * `openAudioStream(url, { engine: "innertube" })`. See this repo's
 * FIXES.md §0 for why:
 *
 * - The URL is bound to the requesting server's IP — you can't hand it to
 *   a browser, whatever calls this still has to fetch/proxy the bytes
 *   itself (this returns the raw upstream stream, unlike the ytdlp-ffmpeg
 *   engine, which already transcodes it).
 * - It's usually webm/opus, not mp3 — fine if your caller doesn't need a
 *   specific container, not fine if it does.
 *
 * Requires the optional `youtubei.js` dependency to be installed; it's
 * imported dynamically so its absence doesn't break anything else in this
 * package.
 *
 * YouTube's default WEB client no longer hands out a per-format URL at all
 * — playback there now goes through server-side ABR (SABR), which needs a
 * BotGuard-attested token that (as of this writing) can only be minted
 * from inside a real browser DOM, not a plain server process. See
 * https://github.com/LuanRT/YouTube.js/issues/1123. IOS/ANDROID (mobile
 * app clients) haven't been cut over yet and still return a classically
 * signed URL youtubei.js can decipher itself — if both start failing,
 * YouTube has likely cut them over too; check that issue thread.
 */
export const innertubeEngine: Engine = {
  async open(id: ResolvedId, opts: InnertubeOptions = {}): Promise<AudioStreamResult> {
    if (id.site !== "youtube") {
      throw new ExtractionError("UNKNOWN", { cause: new Error(`unsupported site: ${id.site}`) });
    }

    let youtubei: typeof import("youtubei.js");
    try {
      youtubei = await import("youtubei.js");
    } catch (err) {
      throw new ExtractionError("SPAWN_FAILED", {
        cause: new Error('the "youtubei.js" optional dependency is not installed', { cause: err }),
      });
    }

    const { Innertube, UniversalCache } = youtubei;
    const clients = opts.clients ?? ["IOS", "ANDROID"];
    const yt = await Innertube.create({ cache: new UniversalCache(false) });

    let lastError: unknown;
    for (const clientName of clients) {
      let info;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        info = await yt.getBasicInfo(id.id, { client: clientName as any });
      } catch (err) {
        lastError = err;
        continue; // this client couldn't fetch the video at all — try the next
      }
      if (!info.streaming_data) continue; // e.g. a live stream with no on-demand formats

      const formats = [...info.streaming_data.formats, ...info.streaming_data.adaptive_formats]
        .filter((f) => f.has_audio)
        .sort((a, b) => Number(a.has_video) - Number(b.has_video)); // audio-only first

      for (const format of formats) {
        try {
          const streamUrl = await format.decipher(yt.session.player);
          if (!streamUrl) continue;

          const controller = new AbortController();
          if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort(), { once: true });

          const res = await fetch(streamUrl, { signal: controller.signal });
          if (!res.ok || !res.body) {
            lastError = new Error(`upstream responded ${res.status}`);
            continue;
          }
          return { stream: res.body, contentType: format.mime_type, abort: () => controller.abort() };
        } catch (err) {
          lastError = err; // this format couldn't be deciphered/fetched — try the next one
        }
      }
    }

    throw new ExtractionError("UNAVAILABLE", { cause: lastError });
  },
};
