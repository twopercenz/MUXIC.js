import { TooManyExtractionsError } from "./errors.js";

export interface Slots {
  /** Throws TooManyExtractionsError if the limit is already reached.
   *  Returns a release function — idempotent, safe to call more than once. */
  acquire(): () => void;
  readonly active: number;
}

export function createSlots(limit: number): Slots {
  let active = 0;
  return {
    acquire() {
      if (active >= limit) throw new TooManyExtractionsError(limit);
      active++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active--;
      };
    },
    get active() {
      return active;
    },
  };
}
