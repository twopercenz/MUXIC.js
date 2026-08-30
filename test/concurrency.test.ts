import { test, expect } from "bun:test";
import { createSlots } from "../src/concurrency.js";
import { TooManyExtractionsError } from "../src/errors.js";

test("acquires up to the limit, then throws", () => {
  const slots = createSlots(2);
  const release1 = slots.acquire();
  const release2 = slots.acquire();
  expect(slots.active).toBe(2);
  expect(() => slots.acquire()).toThrow(TooManyExtractionsError);

  release1();
  expect(slots.active).toBe(1);
  release2();
  expect(slots.active).toBe(0);
});

test("release is idempotent", () => {
  const slots = createSlots(1);
  const release = slots.acquire();
  release();
  release();
  expect(slots.active).toBe(0);
});

test("a freed slot can be re-acquired", () => {
  const slots = createSlots(1);
  slots.acquire()();
  expect(() => slots.acquire()).not.toThrow();
});
