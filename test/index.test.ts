import { test, expect } from "bun:test";
import { registerResolver, registerEngine, openAudioStream } from "../src/index.js";

test("dispatches to the matching resolver + named engine", async () => {
  registerResolver({
    test: (url) => new URL(url).hostname === "dispatch-test.example",
    resolve: () => ({ site: "dispatch-test", id: "x" }),
  });
  registerEngine("fake", {
    open: async () => ({
      stream: new ReadableStream(),
      contentType: "audio/mpeg",
      abort: () => {},
    }),
  });

  const result = await openAudioStream("https://dispatch-test.example/video/1", { engine: "fake" });
  expect(result.contentType).toBe("audio/mpeg");
});

test("throws for a url with no matching resolver", async () => {
  await expect(openAudioStream("https://nowhere.invalid/x")).rejects.toThrow();
});

test("throws for an unregistered engine name", async () => {
  registerResolver({
    test: (url) => new URL(url).hostname === "known-engine-test.example",
    resolve: () => ({ site: "known-engine-test", id: "y" }),
  });
  await expect(openAudioStream("https://known-engine-test.example/", { engine: "nope" })).rejects.toThrow();
});
