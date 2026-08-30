# MUXIC.js

mp3 downloader — a small extraction library, not a CLI. Resolves a URL to a
site + id (**resolver**), then hands that to something that actually
produces bytes (**engine**).

```ts
import { openAudioStream } from "muxic";

const { stream, contentType, abort } = await openAudioStream(
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
);
// stream: ReadableStream<Uint8Array>, contentType: "audio/mpeg"
```

## Engines

- **`ytdlp-ffmpeg`** (default) — pipes `yt-dlp` into `ffmpeg`, returns an
  mp3 stream. Requires both binaries on `PATH`. This is the one to run in
  production: yt-dlp is the actively-maintained side of YouTube's
  extraction arms race, and the stream it returns is already yours to
  serve to a browser.
- **`innertube`** (optional, not registered by default) — a JS-only
  fast-path via [`youtubei.js`](https://github.com/LuanRT/YouTube.js), no
  process spawn. Returns the *raw* upstream stream (usually webm/opus, not
  mp3) at a URL bound to the requesting server's IP — fine for a quick
  server-side re-fetch, not something you can hand to a browser directly.
  Opt in explicitly:

  ```ts
  import { openAudioStream, registerEngine, innertubeEngine } from "muxic";
  registerEngine("innertube", innertubeEngine);
  await openAudioStream(url, { engine: "innertube" });
  ```

  Needs the optional `youtubei.js` dependency installed. See
  `src/engines/innertube.ts` for why it isn't the default.

## Requirements

- [Bun](https://bun.sh) to run/test this package — it ships as TypeScript
  source with no build step, and `bun test` is what the test suite uses.
- `yt-dlp` and `ffmpeg` on `PATH` for the default engine.

## Errors

Engines throw `ExtractionError` with a machine-readable `.code`
(`BOT_CHECK`, `PRIVATE`, `UNAVAILABLE`, `GEO_BLOCKED`, `TIMEOUT`, …) — no
user-facing text baked in. Map codes to messages in your own app. See
`src/errors.ts`.

## Design notes

See `FIXES.md` for why the interface and default engine look like this —
in short, a JS-only direct-URL engine (`youtubei.js`) was tried first and
rejected as the default: the URL it returns is IP-bound and can't go to a
browser, isn't guaranteed mp3, and YouTube's ongoing SABR rollout means it
can stop working with no warning (see `src/engines/innertube.ts`'s
top comment). `yt-dlp` remains the default because it's the actively
maintained side of that fight.
