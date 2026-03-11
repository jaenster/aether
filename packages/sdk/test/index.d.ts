import type { Game, ServiceContainer } from "diablo:game";

export interface TestEntry {
  name: string;
  fn: TestFn;
}

export function test(name: string, fn: TestFn): void;

/** @internal */
export function __getTests(): TestEntry[];


// --- Assertions ---

export class AssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AssertionError"
  }
}

export function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new AssertionError(message ?? "Assertion failed")
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected)
    throw new AssertionError(
      message ?? "Expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)
    )
}

export function assertNotEqual<T>(actual: T, notExpected: T, message?: string): void {
  if (actual === notExpected)
    throw new AssertionError(
      message ?? "Value should differ, got " + JSON.stringify(notExpected)
    )
}

export function assertClose(actual: number, expected: number, tolerance: number, message?: string): void {
  if (Math.abs(actual - expected) > tolerance)
    throw new AssertionError(
      message ?? "Expected " + actual + " to be within " + tolerance + " of " + expected
    )
}

// --- Test registration ---

export type TestFn = (game: Game, services: ServiceContainer) => Generator<void>

export interface TestEntry {
  name: string
  fn: TestFn
}

const tests: TestEntry[] = []

export function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

/** Internal — used by test-runner to get registered tests. */
export function __getTests(): TestEntry[] {
  return tests
}
