import { resolve as resolvePath, dirname, join } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";

/**
 * Resolve an import specifier to an absolute file path.
 * Returns null if the specifier should be resolved client-side (diablo2:*).
 * Throws if the module cannot be found.
 */
export function resolveModule(specifier: string, fromPath: string): string | null {
  // diablo2:* modules are resolved client-side
  if (specifier.startsWith("diablo2:")) {
    return null;
  }

  const fromDir = dirname(fromPath);

  // Relative imports
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return resolveRelative(specifier, fromDir);
  }

  // Bare specifiers — walk node_modules
  return resolveNodeModules(specifier, fromDir);
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
