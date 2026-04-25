/**
 * Pickit checker — pluggable NIP item filter.
 *
 * Default backend: AOT compiled NIP (scripts/generated/pickit-nip.ts).
 * Swap createChecker import for a runtime-compile backend if needed.
 */

import type { Game, ItemUnit } from "diablo:game"
import {
  createChecker, describeRule,
  type NipChecker, type NipHelpers, type NipResult,
} from "../generated/pickit-nip.js"

export type PickitVerdict = 0 | 1 | -1  // 0=skip, 1=keep, -1=id-then-check

export interface PickitMatch {
  verdict: PickitVerdict
  /** .nip file that matched, or null when no rule matched. */
  file: string | null
  /** 1-based line number within `file`. */
  line: number
  /** Source text of the matched rule, or null when unavailable. */
  rule: string | null
}

let _checker: NipChecker | null = null

function getChecker(game?: Game): NipChecker {
  if (_checker) return _checker
  const helpers: NipHelpers = {
    me: game ? {
      get charlvl() { return game.charLevel },
      get classid() { return game.player.classid },
    } : {},
    checkQuantityOwned: () => false,
    getBaseStat: () => 0,
  }
  _checker = createChecker(helpers)
  return _checker
}

/** Reset the checker — call after login if helpers depend on live state. */
export function resetChecker(): void { _checker = null }

/** Plain verdict for a ground item: 1=pick, 0=skip, -1=pick-then-identify. */
export function checkItemNip(item: ItemUnit, game?: Game): PickitVerdict {
  return getChecker(game).checkItem(item as unknown as Parameters<NipChecker["checkItem"]>[0]) as PickitVerdict
}

/** Verbose verdict with matched file/line/rule — for log output. */
export function matchItemNip(item: ItemUnit, game?: Game): PickitMatch {
  const v = getChecker(game).checkItem(item as unknown as Parameters<NipChecker["checkItem"]>[0], true as unknown as never) as {
    result: NipResult; file: string | null; line: number
  }
  return {
    verdict: v.result as PickitVerdict,
    file: v.file,
    line: v.line,
    rule: describeRule(v.file, v.line),
  }
}
