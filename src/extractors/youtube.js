import { Innertube } from 'youtubei.js';

// ponytail: single shared client, no per-call re-auth. Fine for a library used from one process.
let clientPromise;
function client() {
  clientPromise ??= Innertube.create();
  return clientPromise;
}

function extractId(url) {
  const u = new URL(url);
  if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2];
  return u.searchParams.get('v');
}

export const youtube = {
  test: (url) => /(?:^|\.)youtube\.com$|^youtu\.be$/.test(new URL(url).hostname),

  async extract(url) {
    const yt = await client();
    const id = extractId(url);
    if (!id) throw new Error(`Could not find a video id in: ${url}`);

    const info = await yt.getInfo(id);
    const all = [...info.streaming_data.formats, ...info.streaming_data.adaptive_formats];

    const formats = all.map((f) => ({
      itag: f.itag,
      url: f.decipher(yt.session.player),
      mimeType: f.mime_type,
      container: f.mime_type.split(';')[0].split('/')[1],
      hasAudio: !!f.has_audio,
      hasVideo: !!f.has_video,
      bitrate: f.bitrate,
      qualityLabel: f.quality_label ?? null,
    }));

    return {
      id: info.basic_info.id,
      title: info.basic_info.title,
      duration: info.basic_info.duration,
      thumbnail: info.basic_info.thumbnail?.at(-1)?.url ?? null,
      formats,
    };
  },
};
