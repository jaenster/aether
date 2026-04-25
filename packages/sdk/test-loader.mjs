// Node loader for running SDK unit tests under tsx.
// Aliases `diablo:constants` etc. to the actual SDK source files so tests can
// import the exact same specifiers that production code uses.
import { fileURLToPath } from "node:url"
import { dirname, resolve as pathResolve } from "node:path"

const SDK_ROOT = dirname(fileURLToPath(import.meta.url))

const ALIASES = {
  "diablo:constants": pathResolve(SDK_ROOT, "constants/index.ts"),
  "diablo:game": pathResolve(SDK_ROOT, "game/index.d.ts"),
}

export async function resolve(specifier, context, nextResolve) {
  if (ALIASES[specifier]) {
    return nextResolve("file://" + ALIASES[specifier], context)
  }
  return nextResolve(specifier, context)
}
