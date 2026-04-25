/**
 * NPC interaction helpers — ported from Ryuk's talkTo pattern.
 *
 * Walk to NPC → interact → wait for menu → do action → close dialog.
 * NPCs found by preset (type=1, classid from monstats), not by scanning loaded monsters.
 */

import { type Game, type NPC, UiFlags } from "diablo:game"
import { closeNPCInteract, getUIFlag, npcMenuSelect as nativeNpcMenuSelect } from "diablo:native"
import { walkTo } from "./walk-clear.js"

/** Walk to an NPC and interact. Returns the NPC unit or null. */
export function* interactNPC(game: Game, classid: number): Generator<void, NPC | null> {
  // Find NPC by scanning visible monsters
  let npc = game.npcs.find(n => n.classid === classid)

  if (!npc) {
    // Try finding via preset and walking closer
    const preset = game.findPreset(1, classid)
    if (preset) {
      yield* walkTo(game, preset.x, preset.y)
      yield* game.delay(500)
      npc = game.npcs.find(n => n.classid === classid)
    }
  }

  if (!npc) {
    // Last resort: scan all monsters (NPCs are type 1 units)
    for (const m of game.monsters) {
      if (m.classid === classid) {
        yield* walkTo(game, m.x, m.y)
        yield* game.delay(300)
        npc = game.npcs.find(n => n.classid === classid)
        break
      }
    }
  }

  if (!npc) return null

  // Walk close to NPC
  if (npc.distance > 4) {
    yield* walkTo(game, npc.x, npc.y)
  }

  // Interact
  game.interact(npc)

  // Wait for NPC menu or shop UI
  for (let i = 0; i < 50; i++) {
    yield
    if (getUIFlag(UiFlags.NPCMenu) || getUIFlag(UiFlags.Shop)) return npc
  }

  return npc
}

/** Close any open NPC dialog/menu */
export function dismissNPC() {
  closeNPCInteract()
}

/** Talk to NPC and heal (free — just interacting heals you) */
export function* healAtNPC(game: Game, classid: number): Generator<void> {
  const npc = yield* interactNPC(game, classid)
  if (!npc) {
    game.log('[npc] healer classid=' + classid + ' not found')
    return
  }
  // Interacting with a healer auto-heals. Just close the dialog.
  yield* game.delay(300)
  dismissNPC()
  yield* game.delay(200)
  game.log('[npc] healed at ' + (npc.name ?? 'NPC') + ' hp=' + game.player.hp + '/' + game.player.hpmax)
}

/** Talk to NPC and open trade. Caller handles buying/selling. Close with dismissNPC(). */
export function* openTrade(game: Game, classid: number): Generator<void, boolean> {
  const npc = yield* interactNPC(game, classid)
  if (!npc) return false

  // Select "Trade" from NPC menu if menu is showing
  if (getUIFlag(UiFlags.NPCMenu)) {
    nativeNpcMenuSelect(0) // first menu option is usually Trade
    yield* game.delay(500)
  }

  return getUIFlag(UiFlags.Shop)
}

/** Talk to NPC and repair all items */
export function* repairAtNPC(game: Game, classid: number): Generator<void> {
  const npc = yield* interactNPC(game, classid)
  if (!npc) return

  if (getUIFlag(UiFlags.NPCMenu)) {
    nativeNpcMenuSelect(0) // Trade/Repair
    yield* game.delay(500)
  }

  // TODO: send repair packet
  dismissNPC()
  yield* game.delay(200)
}

// ── Known NPC classids per act ──────────────────────────────────────

export const Healers: Record<number, number> = {
  1: 148,  // Akara (Act 1)
  2: 178,  // Fara (Act 2)
  3: 255,  // Ormus (Act 3)
  4: 405,  // Jamella (Act 4)
  5: 513,  // Malah (Act 5)
}

export const Repairers: Record<number, number> = {
  1: 154,  // Charsi (Act 1)
  2: 178,  // Fara (Act 2)
  3: 253,  // Hratli (Act 3)
  4: 405,  // Jamella (Act 4)  (also heals)
  5: 511,  // Larzuk (Act 5)
}

export const Traders: Record<number, number> = {
  1: 148,  // Akara (Act 1) — also heals
  2: 178,  // Fara (Act 2)
  3: 255,  // Ormus (Act 3)
  4: 405,  // Jamella (Act 4)
  5: 513,  // Malah (Act 5)
}

/** Get the current act number (1-5) from area */
export function getAct(area: number): number {
  if (area <= 39) return 1
  if (area <= 74) return 2
  if (area <= 102) return 3
  if (area <= 108) return 4
  return 5
}

/** Heal at the appropriate NPC for the current act */
export function* healInTown(game: Game): Generator<void> {
  const act = getAct(game.area)
  const classid = Healers[act]
  if (!classid) return

  // Walk toward healer area first to load rooms (NPCs aren't visible until nearby)
  if (act === 1) {
    // Akara is near the center-east of Rogue Encampment
    yield* walkTo(game, game.player.x + 10, game.player.y - 5, 8)
    yield* game.delay(200)
  }

  yield* healAtNPC(game, classid)
}
