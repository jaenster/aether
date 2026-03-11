import type { Game, ServiceContainer } from "diablo:game";

// --- Assertions ---

export class AssertionError extends Error {
  constructor(message: string);
}

export function assert(condition: unknown, message?: string): asserts condition;

export function assertEqual<T>(actual: T, expected: T, message?: string): void;

export function assertNotEqual<T>(actual: T, notExpected: T, message?: string): void;

export function assertClose(actual: number, expected: number, tolerance: number, message?: string): void;

// --- Test registration ---

export type TestFn = (game: Game, services: ServiceContainer) => Generator<void>;

export interface TestEntry {
  name: string;
  fn: TestFn;
}

export function test(name: string, fn: TestFn): void;

/** @internal */
export function __getTests(): TestEntry[];
