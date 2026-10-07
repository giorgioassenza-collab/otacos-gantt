/**
 * Injectable clock and randomness.
 *
 * The data layer never calls Date.now() / new Date() / Math.random() directly:
 * everything goes through here so tests can pin time and ids.
 */
let clockFn: () => number = () => Date.now();
let randomFn: () => number = () => Math.random();

/** Replace the clock (epoch milliseconds). Call with no argument to restore the real clock. */
export function setClock(fn?: (() => number) | null): void {
  clockFn = fn ?? (() => Date.now());
}

/** Replace the random source (used for generated ids). Call with no argument to restore Math.random. */
export function setRandom(fn?: (() => number) | null): void {
  randomFn = fn ?? (() => Math.random());
}

/** Current time in epoch milliseconds (equivalent of Date.now()). */
export function now(): number {
  return clockFn();
}

/** Current time as a Date (equivalent of new Date()). */
export function nowDate(): Date {
  return new Date(clockFn());
}

/** Equivalent of Math.random(). */
export function random(): number {
  return randomFn();
}
