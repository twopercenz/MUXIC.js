import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioStreamResult, Engine, EngineOpenOptions, ResolvedId } from "../types.js";
import { ExtractionError, classifyYtDlpError } from "../errors.js";
import { createSlots, type Slots } from "../concurrency.js";

export interface YtDlpFfmpegOptions extends EngineOpenOptions {
  /** Path to a cookies.txt (Netscape format) file, passed straight to
   *  yt-dlp. yt-dlp writes the (possibly refreshed) jar back to this path —
   *  if it's read-only (e.g. a mounted secret file), this falls back to a
   *  writable tmpdir copy automatically. */
  cookiesFile?: string;
  /** Browser to pull cookies from (e.g. "chrome") — local dev only, where
   *  yt-dlp runs on the same machine as the browser. */
  cookiesFromBrowser?: string;
  /** ffmpeg output format. Default "mp3". */
  format?: string;
  /** ffmpeg audio bitrate. Default "192k". */
  bitrate?: string;
  /** Safety backstop for a genuine hang — never what decides success.
   *  Default 45000. */
  timeoutMs?: number;
  /** Max concurrent extractions. Default 2. Fixed at whatever the first
   *  call passes (one shared counter for the process, same as passing a
   *  different limit per call, construct your own via createSlots()). */
  concurrency?: number;
}

let writableCookiesFile: string | null = null;
function getWritableCookiesFile(sourcePath: string): string | null {
  if (writableCookiesFile && existsSync(writableCookiesFile)) return writableCookiesFile;
  try {
    const dest = join(tmpdir(), "yt-dlp-cookies.txt");
    copyFileSync(sourcePath, dest);
    writableCookiesFile = dest;
    return dest;
  } catch (err) {
    console.warn(`Failed to copy cookiesFile to a writable path: ${(err as Error).message}`);
    return null;
  }
}

function getCookieArgs(opts: YtDlpFfmpegOptions): string[] {
  if (opts.cookiesFile) {
    if (!existsSync(opts.cookiesFile)) {
      console.warn(`cookiesFile is set to "${opts.cookiesFile}" but that file doesn't exist`);
    } else {
      const writablePath = getWritableCookiesFile(opts.cookiesFile);
      if (writablePath) return ["--cookies", writablePath];
    }
  }
  if (opts.cookiesFromBrowser) return ["--cookies-from-browser", opts.cookiesFromBrowser];
  return [];
}

let slots: Slots | null = null;
function getSlots(limit: number): Slots {
  slots ??= createSlots(limit);
  return slots;
}

/**
 * Default engine: pipes `yt-dlp` (best audio track, raw) into `ffmpeg`
 * (transcode). Requires both binaries on PATH.
 *
 * Ported from music.player's lib/extract.ts, which validated this in
 * production — see this repo's FIXES.md §0 for why this stays the default
 * over a direct-URL (innertube) engine: a direct googlevideo URL is bound
 * to the requesting server's IP (can't hand it to a browser, someone still
 * has to proxy the bytes), usually isn't mp3, and yt-dlp itself is the
 * actively-maintained side of YouTube's extraction arms race.
 */
export const ytdlpFfmpegEngine: Engine = {
  async open(id: ResolvedId, opts: YtDlpFfmpegOptions = {}): Promise<AudioStreamResult> {
    if (id.site !== "youtube") {
      throw new ExtractionError("UNKNOWN", { cause: new Error(`unsupported site: ${id.site}`) });
    }

    const release = getSlots(opts.concurrency ?? 2).acquire();
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      release();
    };

    const url = `https://www.youtube.com/watch?v=${id.id}`;
    const format = opts.format ?? "mp3";
    const bitrate = opts.bitrate ?? "192k";
    const timeoutMs = opts.timeoutMs ?? 45_000;

    const ytDlp = spawn("yt-dlp", [
      // "/best" fallback matters here: the android/ios clients below often
      // don't expose a pure audio-only format the way the web client does,
      // so a bare "bestaudio" can fail with "Requested format is not
      // available" even though the video itself is fine — "best" (a
      // combined video+audio stream) covers that gap, and ffmpeg's -vn
      // below strips the video back out anyway, so the end result is
      // identical either way.
      "-f",
      "bestaudio/best",
      "--no-playlist",
      "--no-part",
      // yt-dlp now needs a real JS runtime to solve YouTube's signature
      // ("nsig") challenge — without one it only warns ("No supported
      // JavaScript runtime could be found") and silently drops most/all
      // formats, which is what actually produces "Requested format is not
      // available" downstream. Only "deno" is enabled by default, but
      // "bun" is also supported — pass it explicitly if it's on PATH (e.g.
      // via a bun-based container) rather than relying on deno existing.
      "--js-runtimes",
      "bun",
      // The default "web" client is the most fragile against YouTube's
      // ongoing anti-bot changes ("The page needs to be reloaded" is a
      // web-client-only failure mode) — falling back through android/ios
      // avoids most of it, often without even needing cookies. See
      // yt-dlp#16212, #17405.
      "--extractor-args",
      "youtube:player_client=android,ios,web",
      ...getCookieArgs(opts),
      "-o",
      "-",
      "--quiet",
      "--no-warnings",
      url,
    ]);

    const ffmpeg = spawn("ffmpeg", [
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-vn",
      "-f",
      format,
      "-ab",
      bitrate,
      "pipe:1",
    ]);

    ytDlp.stdout.pipe(ffmpeg.stdin);

    let ytDlpStderr = "";
    ytDlp.stderr.on("data", (chunk) => {
      ytDlpStderr += chunk.toString();
    });
    ytDlp.on("close", (code) => {
      if (code !== 0) ffmpeg.stdin.end();
    });

    // The success/failure race below only covers ffmpeg producing its
    // *first* byte — a crash after that (nonzero exit mid-transcode) would
    // otherwise look like a perfectly clean stream end to whoever reads the
    // stream we return, silently truncating whatever they're writing (e.g.
    // a cache file). Surface it as a real stream error instead.
    ffmpeg.once("close", (code) => {
      if (code !== 0 && !ffmpeg.stdout.destroyed) {
        ffmpeg.stdout.destroy(new ExtractionError(classifyYtDlpError(ytDlpStderr)));
      }
    });

    // Neither child process gets killed on its own — a caller aborting, the
    // safety timeout firing, or one of the two failing would otherwise
    // leave the other one running to completion.
    let killed = false;
    const killAll = () => {
      if (killed) return;
      killed = true;
      ytDlp.kill("SIGKILL");
      ffmpeg.kill("SIGKILL");
      releaseOnce();
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        killAll();
        throw new ExtractionError("TIMEOUT", { cause: new Error("aborted before start") });
      }
      opts.signal.addEventListener("abort", killAll, { once: true });
    }

    // Once ffmpeg exits (success or failure), yt-dlp has no reason to keep
    // running even if it's still mid-download.
    ffmpeg.once("close", killAll);

    // A fixed timeout can't tell success from "still working" — yt-dlp's
    // own failures can take anywhere from milliseconds to several seconds
    // (it retries across the player_client list above before giving up).
    // So instead: race real evidence of success (ffmpeg actually produced
    // audio bytes) against real evidence of failure (yt-dlp exited
    // non-zero), with a generous timeout only as a backstop against a
    // genuine hang — never as the thing that decides success.
    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(safetyTimer);
        ffmpeg.stdout.off("readable", onReadable);
        ytDlp.off("error", onYtDlpSpawnError);
        ytDlp.off("close", onYtDlpClose);
        ffmpeg.off("error", onFfmpegSpawnError);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const fail = (err: ExtractionError) => {
        if (settled) return;
        settled = true;
        cleanup();
        killAll();
        reject(err);
      };

      const onReadable = () => {
        const chunk = ffmpeg.stdout.read();
        if (chunk) {
          ffmpeg.stdout.unshift(chunk); // peek without consuming — Readable.toWeb sees it again below
          succeed();
        }
      };
      const onYtDlpSpawnError = (err: Error) => fail(new ExtractionError("SPAWN_FAILED", { cause: err }));
      const onYtDlpClose = (code: number | null) => {
        if (code !== 0) fail(new ExtractionError(classifyYtDlpError(ytDlpStderr), { stderr: ytDlpStderr }));
      };
      const onFfmpegSpawnError = (err: Error) => fail(new ExtractionError("SPAWN_FAILED", { cause: err }));
      const safetyTimer = setTimeout(() => fail(new ExtractionError("TIMEOUT")), timeoutMs);

      ffmpeg.stdout.on("readable", onReadable);
      ytDlp.once("error", onYtDlpSpawnError);
      ytDlp.once("close", onYtDlpClose);
      ffmpeg.once("error", onFfmpegSpawnError);
    });

    return {
      stream: Readable.toWeb(ffmpeg.stdout) as unknown as ReadableStream<Uint8Array>,
      contentType: format === "mp3" ? "audio/mpeg" : `audio/${format}`,
      abort: killAll,
    };
  },
};
