/**
 * Bytes per second from progress ticks. A tick closer than `minGap` to the
 * last sample keeps the last value, and the next one averages over the whole
 * gap — a 300 ms poll still produces a number, and a stalled transfer decays
 * instead of holding its old rate.
 */
export class SpeedMeter {
  private bytes: number;
  private at: number;
  private value = 0;

  constructor(bytes: number, at: number) {
    this.bytes = bytes;
    this.at = at;
  }

  sample(received: number, now: number, minGap = 0.4): number {
    const elapsed = (now - this.at) / 1000;
    if (elapsed < minGap) return this.value;
    const instant = Math.max(0, (received - this.bytes) / elapsed);
    this.value = this.value > 0 ? this.value * 0.6 + instant * 0.4 : instant;
    this.bytes = received;
    this.at = now;
    return this.value;
  }
}
