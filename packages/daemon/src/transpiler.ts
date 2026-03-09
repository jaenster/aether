import { transformSync } from "@swc/core";
import { readFileSync, statSync } from "node:fs";

interface CacheEntry {
  js: string;
  mtime: number;
}

const cache = new Map<string, CacheEntry>();

const SWC_OPTIONS = {
  jsc: {
    parser: {
      syntax: "typescript" as const,
      tsx: false,
      decorators: true,
    },
    target: "es2020" as const,
  },
  module: {
    type: "es6" as const,
  },
  sourceMaps: "inline" as const,
} as const;

/**
 * Transpile a TypeScript file to JavaScript.
 * Results are cached by path + mtime.
 */
export function transpile(filePath: string): string {
  const stat = statSync(filePath);
  const mtime = stat.mtimeMs;

  const cached = cache.get(filePath);
  if (cached && cached.mtime === mtime) {
    return cached.js;
  }

  const source = readFileSync(filePath, "utf-8");
  const result = transpileSource(source, filePath);

  cache.set(filePath, { js: result, mtime });
  return result;
}

/**
 * Transpile a TypeScript source string to JavaScript.
 */
export function transpileSource(source: string, filename: string = "input.ts"): string {
  const result = transformSync(source, {
    ...SWC_OPTIONS,
    filename,
  });
  return result.code;
}

/**
 * Invalidate cache for specific paths.
 */
export function invalidate(paths: string[]): void {
  for (const p of paths) {
    cache.delete(p);
  }
}

/**
 * Clear entire transpile cache.
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Get cache size.
 */
export function cacheSize(): number {
  return cache.size;
}
