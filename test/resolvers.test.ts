import { test, expect } from "bun:test";
import { youtubeResolver } from "../src/resolvers/youtube.js";

test("recognizes youtube.com watch urls", () => {
  expect(youtubeResolver.test("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
});

test("recognizes youtu.be short urls", () => {
  expect(youtubeResolver.test("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
});

test("rejects unrelated urls", () => {
  expect(youtubeResolver.test("https://example.com/video/1")).toBe(false);
});

test("rejects garbage input instead of throwing", () => {
  expect(youtubeResolver.test("not a url")).toBe(false);
});

test("resolves a watch url", () => {
  expect(youtubeResolver.resolve("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
    site: "youtube",
    id: "dQw4w9WgXcQ",
  });
});

test("resolves a youtu.be url", () => {
  expect(youtubeResolver.resolve("https://youtu.be/dQw4w9WgXcQ")).toEqual({
    site: "youtube",
    id: "dQw4w9WgXcQ",
  });
});

test("resolves a shorts url", () => {
  expect(youtubeResolver.resolve("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toEqual({
    site: "youtube",
    id: "dQw4w9WgXcQ",
  });
});

test("throws when no id is present", () => {
  expect(() => youtubeResolver.resolve("https://www.youtube.com/watch")).toThrow();
});
