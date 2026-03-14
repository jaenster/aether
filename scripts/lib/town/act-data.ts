import type { Game } from "diablo:game"

/** Known stash object classids — Bank object in D2 */
export const stashClassIds = new Set([267, 501])

/** Find the stash object unit in the current area */
export function findStash(game: Game) {
  return game.objects.find(o => stashClassIds.has(o.classid)) ?? null
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2, dy = y1 - y2
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Get distance from player to a given NPC (by classid).
 * Returns Infinity if NPC not found in current area.
 */
export function distToNpc(game: Game, classid: number): number {
  if (classid === -1) {
    // Stash
    const stash = findStash(game)
    if (!stash) return Infinity
    return dist(game.player.x, game.player.y, stash.x, stash.y)
  }
  const npc = game.npcs.find(n => n.classid === classid)
  if (!npc) return Infinity
  return dist(game.player.x, game.player.y, npc.x, npc.y)
}
