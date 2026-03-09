import { transpile } from "./transpiler.js";
import { resolveModule } from "./resolver.js";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

export interface ModuleInfo {
  path: string;
  source: string;
  deps: string[];
}

/**
 * Bundle an entry point: resolve all dependencies, transpile .ts → .js,
 * return modules in topological (dependency-first) order.
 */
export function bundle(entryPath: string): ModuleInfo[] {
  const absEntry = resolvePath(entryPath);
  const modules = new Map<string, ModuleInfo>();
  const visiting = new Set<string>();

  walk(absEntry, modules, visiting);

  // Topological sort — dependencies before dependents
  return topologicalSort(modules);
}

function walk(
  filePath: string,
  modules: Map<string, ModuleInfo>,
  visiting: Set<string>,
): void {
  if (modules.has(filePath)) return;
  if (visiting.has(filePath)) return; // circular dependency — skip

  visiting.add(filePath);

  // Transpile if .ts, otherwise read raw
  const source = filePath.endsWith(".ts") || filePath.endsWith(".tsx")
    ? transpile(filePath)
    : readFileSync(filePath, "utf-8");

  // Extract import specifiers from the transpiled source
  const importSpecifiers = extractImports(source);

  // Resolve each import
  const deps: string[] = [];
  for (const spec of importSpecifiers) {
    const resolved = resolveModule(spec, filePath);
    if (resolved === null) {
      // diablo2:* — keep as-is, resolved client-side
      deps.push(spec);
      continue;
    }
    deps.push(resolved);
    walk(resolved, modules, visiting);
  }

  modules.set(filePath, { path: filePath, source, deps });
  visiting.delete(filePath);
}

/**
 * Extract import specifiers from JavaScript source using regex.
 * Handles: import ... from "specifier", import "specifier",
 * export ... from "specifier", dynamic import("specifier")
 */
function extractImports(source: string): string[] {
  const specifiers: string[] = [];

  // Static imports/exports: import/export ... from "specifier"
  const staticRe = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  let match;
  while ((match = staticRe.exec(source)) !== null) {
    specifiers.push(match[1]);
  }

  // Dynamic imports: import("specifier")
  const dynamicRe = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamicRe.exec(source)) !== null) {
    specifiers.push(match[1]);
  }

  // Dedupe
  return [...new Set(specifiers)];
}

/**
 * Topological sort — Kahn's algorithm.
 * Returns modules in dependency-first order.
 */
function topologicalSort(modules: Map<string, ModuleInfo>): ModuleInfo[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  // Initialize
  for (const [path] of modules) {
    inDegree.set(path, 0);
    dependents.set(path, []);
  }

  // Build edges
  for (const [path, mod] of modules) {
    for (const dep of mod.deps) {
      if (modules.has(dep)) {
        inDegree.set(path, (inDegree.get(path) || 0) + 1);
        dependents.get(dep)!.push(path);
      }
    }
  }

  // Process nodes with no dependencies first
  const queue: string[] = [];
  for (const [path, degree] of inDegree) {
    if (degree === 0) queue.push(path);
  }

  const result: ModuleInfo[] = [];
  while (queue.length > 0) {
    const path = queue.shift()!;
    result.push(modules.get(path)!);

    for (const dep of dependents.get(path) || []) {
      const newDegree = (inDegree.get(dep) || 1) - 1;
      inDegree.set(dep, newDegree);
      if (newDegree === 0) queue.push(dep);
    }
  }

  // If there are remaining modules (circular deps), add them anyway
  for (const [path, mod] of modules) {
    if (!result.includes(mod)) {
      result.push(mod);
    }
  }

  return result;
}
