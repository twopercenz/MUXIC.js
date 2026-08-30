import { youtube } from './extractors/youtube.js';

const extractors = [youtube];

/** Add support for another site: { test(url) => bool, extract(url) => VideoInfo } */
export function registerExtractor(extractor) {
  extractors.push(extractor);
}

/** @returns {Promise<{id, title, duration, thumbnail, formats}>} */
export async function extract(url) {
  const extractor = extractors.find((e) => e.test(url));
  if (!extractor) throw new Error(`No extractor registered for URL: ${url}`);
  return extractor.extract(url);
}

export function pickFormat(formats, quality = 'best') {
  const withAudio = formats.filter((f) => f.hasAudio);
  const pool =
    quality === 'audio' ? formats.filter((f) => f.hasAudio && !f.hasVideo) : withAudio.length ? withAudio : formats;
  return pool.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0] ?? null;
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * Node-only convenience: extract + fetch + write to disk.
 * No audio/video muxing (ffmpeg) — pick 'audio' for an audio-only stream,
 * or pass a `filter` to grab a specific combined format yourself.
 */
export async function download(url, { quality = 'best', filter, output } = {}) {
  if (typeof process === 'undefined' || !process.versions?.node) {
    throw new Error('download() is Node-only. In the browser, call extract() and fetch a format URL yourself.');
  }
  const info = await extract(url);
  const format = filter ? info.formats.find(filter) : pickFormat(info.formats, quality);
  if (!format) throw new Error('No matching format found');

  const res = await fetch(format.url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

  const { writeFile } = await import('node:fs/promises');
  const path = output ?? `${sanitizeFilename(info.title)}.${format.container}`;
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  return path;
}
