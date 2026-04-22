import { MAX_PLAYERS, InputCommand, type PlayerInput } from "@netrek/shared";

const MAX_INPUTS_PER_TICK = 32;

/**
 * Per-player input queues. Bounded ring buffers.
 * Inputs are drained each tick by the game loop.
 */
export class InputQueue {
  private readonly queues: PlayerInput[][];
  private readonly counts: number[];

  constructor() {
    this.queues = Array.from({ length: MAX_PLAYERS }, () =>
      Array.from({ length: MAX_INPUTS_PER_TICK }, () => ({
        command: InputCommand.SET_DIRECTION,
        tick: 0,
        value: 0,
      })),
    );
    this.counts = new Array(MAX_PLAYERS).fill(0) as number[];
  }

  /** Push an input for a player slot. Drops if buffer full. */
  enqueue(slot: number, input: PlayerInput): void {
    const count = this.counts[slot]!;
    if (count >= MAX_INPUTS_PER_TICK) return; // drop
    const entry = this.queues[slot]![count]!;
    entry.command = input.command;
    entry.tick = input.tick;
    entry.value = input.value;
    this.counts[slot] = count + 1;
  }

  /** Drain all inputs for a slot. Returns count and the underlying array (read up to count). */
  drain(slot: number): { inputs: PlayerInput[]; count: number } {
    const count = this.counts[slot]!;
    this.counts[slot] = 0;
    return { inputs: this.queues[slot]!, count };
  }
}
