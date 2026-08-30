import type { Resolver } from "../types.js";

function extractId(url: URL): string | null {
  if (url.hostname === "youtu.be") return url.pathname.slice(1) || null;
  if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2] ?? null;
  return url.searchParams.get("v");
}

function isYoutubeHost(hostname: string): boolean {
  return /(?:^|\.)youtube\.com$|^youtu\.be$/.test(hostname);
}

export const youtubeResolver: Resolver = {
  test(url) {
    try {
      return isYoutubeHost(new URL(url).hostname);
    } catch {
      return false;
    }
  },

  resolve(url) {
    const parsed = new URL(url);
    const id = extractId(parsed);
    if (!id) throw new Error(`Could not find a video id in: ${url}`);
    return { site: "youtube", id };
  },
};
