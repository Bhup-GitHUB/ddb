import type { Clock } from "./types";

export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
}

export class FakeClock implements Clock {
  private currentMs: number;

  constructor(startMs = 0) {
    this.currentMs = startMs;
  }

  nowMs(): number {
    return this.currentMs;
  }

  advance(ms: number): void {
    if (ms < 0) throw new Error("clock cannot move backwards");
    this.currentMs += ms;
  }
}
