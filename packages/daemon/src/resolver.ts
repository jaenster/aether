import { resolve as resolvePath, relative as relativePath, dirname, join } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SDK root — aether/packages/sdk/ relative to this package
const SDK_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../sdk");

export interface ResolveResult {
  path: string;
  /** If set, use this as the module specifier instead of the computed relative path */
  specifierOverride?: string;
}

/**
 * Resolve an import specifier to an absolute file path.
 * Returns null if the specifier should be resolved client-side (diablo:native).
 * Returns a ResolveResult for file-backed modules.
 * Throws if the module cannot be found.
 */
export function resolveModule(specifier: string, fromPath: string): ResolveResult | null {
  // diablo:native and other unhandled scheme imports are resolved client-side
  if (specifier === "diablo:native") {
    return null;
  }

  // Pass through any non-diablo: scheme specifiers (e.g. node:fs, diablo2:foo)
  // — they're resolved at runtime, not bundled.
  if (/^[a-z][a-z0-9]*:/.test(specifier) && !specifier.startsWith("diablo:")) {
    return null;
  }

  // diablo:game → SDK barrel (bundled + sent to client)
  if (specifier === "diablo:game") {
    const sdkEntry = join(SDK_ROOT, "game/index.d.ts");
    if (!existsSync(sdkEntry)) {
      throw new Error(`SDK not found: ${sdkEntry}`);
    }
    return { path: sdkEntry, specifierOverride: "diablo:game" };
  }

  // diablo:constants → SDK constants (areas, skills, stats, etc.)
  if (specifier === "diablo:constants") {
    const constantsEntry = join(SDK_ROOT, "constants/index.ts");
    if (!existsSync(constantsEntry)) {
      throw new Error(`SDK constants module not found: ${constantsEntry}`);
    }
    return { path: constantsEntry, specifierOverride: "diablo:constants" };
  }

  // diablo:test → SDK test framework (bundled + sent to client)
  if (specifier === "diablo:test") {
    const testEntry = join(SDK_ROOT, "test/index.ts");
    if (!existsSync(testEntry)) {
      throw new Error(`SDK test module not found: ${testEntry}`);
    }
    return { path: testEntry, specifierOverride: "diablo:test" };
  }

  // diablo:test-runner → SDK test runner (bundled + sent to client)
  if (specifier === "diablo:test-runner") {
    const runnerEntry = join(SDK_ROOT, "test/runner.ts");
    if (!existsSync(runnerEntry)) {
      throw new Error(`SDK test runner not found: ${runnerEntry}`);
    }
    return { path: runnerEntry, specifierOverride: "diablo:test-runner" };
  }

  const fromDir = dirname(fromPath);

  // Relative imports
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const resolved = resolveRelative(specifier, fromDir);
    // SDK files get simplified specifiers so SM60 module resolution works.
    // diablo:game's dirname is "./" so relative imports resolve to "./filename.ts".
    const override = getSdkSpecifierOverride(resolved);
    return override ? { path: resolved, specifierOverride: override } : { path: resolved };
  }

  // Bare specifiers — walk node_modules
  return { path: resolveNodeModules(specifier, fromDir) };
}

/**
 * If a file is inside the SDK directory, return a specifier that matches
 * SM60's resolution from diablo:game (dirname="./").
 */
function getSdkSpecifierOverride(absPath: string): string | undefined {
  if (!absPath.startsWith(SDK_ROOT)) return undefined;
  const rel = relativePath(SDK_ROOT, absPath).replace(/\\/g, "/");
  return "./" + rel;
}

function resolveRelative(specifier: string, fromDir: string): string {
  const base = resolvePath(fromDir, specifier);

  // Try exact path
  const exact = tryExtensions(base);
  if (exact) return exact;

  // Try as directory (index file)
  const index = tryIndex(base);
  if (index) return index;

  throw new Error(`Cannot resolve '${specifier}' from '${fromDir}'`);
}

function resolveNodeModules(specifier: string, fromDir: string): string {
  let dir = fromDir;

  while (true) {
    const nmDir = join(dir, "node_modules");
    if (existsSync(nmDir)) {
      const pkgDir = join(nmDir, specifier);

      // Check package.json exports/main
      const pkgJson = join(pkgDir, "package.json");
      if (existsSync(pkgJson)) {
        const pkg = JSON.parse(readFileSync(pkgJson, "utf-8"));

        // Check exports field (simplified — just "." entry)
        if (pkg.exports) {
          const entry = typeof pkg.exports === "string"
            ? pkg.exports
            : pkg.exports["."]?.import || pkg.exports["."]?.default || pkg.exports["."];
          if (typeof entry === "string") {
            const resolved = resolvePath(pkgDir, entry);
            if (existsSync(resolved)) return resolved;
          }
        }

        // Check main field
        if (pkg.main) {
          const resolved = resolvePath(pkgDir, pkg.main);
          const exact = tryExtensions(resolved);
          if (exact) return exact;
        }

        // Default: index
        const index = tryIndex(pkgDir);
        if (index) return index;
      }

      // Not a package — maybe a file in node_modules
      const exact = tryExtensions(pkgDir);
      if (exact) return exact;
    }

    const parent = dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }

  throw new Error(`Cannot find module '${specifier}' from '${fromDir}'`);
}

const EXTENSIONS = [".ts", ".js", ".tsx", ".jsx", ".mjs"];

function tryExtensions(base: string): string | null {
  // Exact match first
  if (existsSync(base) && !isDirectory(base)) return base;

  // ESM convention: .js import → .ts source file
  if (base.endsWith(".js")) {
    const tsPath = base.slice(0, -3) + ".ts";
    if (existsSync(tsPath) && !isDirectory(tsPath)) return tsPath;
    const tsxPath = base.slice(0, -3) + ".tsx";
    if (existsSync(tsxPath) && !isDirectory(tsxPath)) return tsxPath;
  }

  // Try adding extensions
  for (const ext of EXTENSIONS) {
    const p = base + ext;
    if (existsSync(p)) return p;
  }

  return null;
}

function tryIndex(dir: string): string | null {
  for (const ext of EXTENSIONS) {
    const p = join(dir, "index" + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
