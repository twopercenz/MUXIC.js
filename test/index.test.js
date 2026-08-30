import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerExtractor, extract, pickFormat } from '../src/index.js';

test('dispatches to the matching registered extractor', async () => {
  registerExtractor({
    test: (url) => new URL(url).hostname === 'example.com',
    extract: async (url) => ({ id: 'x', title: 'demo', formats: [], url }),
  });
  const result = await extract('https://example.com/video/1');
  assert.equal(result.id, 'x');
});

test('throws for a url with no matching extractor', async () => {
  await assert.rejects(() => extract('https://nowhere.invalid/x'));
});

test('pickFormat prefers a format with audio, highest bitrate first', () => {
  const formats = [
    { hasAudio: true, hasVideo: true, bitrate: 500 },
    { hasAudio: true, hasVideo: true, bitrate: 1500 },
    { hasAudio: false, hasVideo: true, bitrate: 9000 },
  ];
  assert.equal(pickFormat(formats).bitrate, 1500);
});

test('pickFormat("audio") only returns audio-only formats', () => {
  const formats = [
    { hasAudio: true, hasVideo: true, bitrate: 1500 },
    { hasAudio: true, hasVideo: false, bitrate: 128 },
  ];
  assert.equal(pickFormat(formats, 'audio').bitrate, 128);
});
