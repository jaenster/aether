/**
 * Act 5 leveling — Rescue Barbs, Anya, Ancients, Baal.
 */

import { type Game, Area } from "diablo:game"
import { moveTo, moveToExit } from "../lib/walk-clear.js"
import { killQuestBoss, interactQuestObject } from "../lib/quest-interact.js"
import { activateWaypoint } from "../lib/waypoint-interact.js"
import { healInTown } from "../lib/npc.js"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

const BAAL = 544       // classid (Worldstone Chamber)
const BAAL_THRONE = 543 // classid (Throne version, runs away)

export function* act5Leveling(game: Game, svc: any) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)

  if (game.area === Area.Harrogath && game.player.hp < game.player.maxHp) {
    yield* healInTown(game)
  }

  // ── Town ──
  if (game.area === Area.Harrogath) {
    yield* moveToExit(game, atk, pickit, Area.BloodyFoothills)
    return
  }

  // ── Outdoor chain ──
  const outdoorChain = [
    [Area.BloodyFoothills, Area.FrigidHighlands],
    [Area.FrigidHighlands, Area.ArreatPlateau],
    [Area.ArreatPlateau, Area.CrystalizedPassage],
    [Area.CrystalizedPassage, Area.GlacialTrail],
    [Area.GlacialTrail, Area.FrozenTundra],
    [Area.FrozenTundra, Area.AncientsWay],
    [Area.AncientsWay, Area.ArreatSummit],
  ] as const

  for (const [from, to] of outdoorChain) {
    if (game.area === from) {
      // Waypoints
      if (from === Area.BloodyFoothills && !game.hasWaypoint(31)) yield* activateWaypoint(game, move)
      if (from === Area.FrigidHighlands && !game.hasWaypoint(32)) yield* activateWaypoint(game, move)
      if (from === Area.ArreatPlateau && !game.hasWaypoint(33)) yield* activateWaypoint(game, move)
      if (from === Area.CrystalizedPassage && !game.hasWaypoint(34)) yield* activateWaypoint(game, move)
      if (from === Area.GlacialTrail && !game.hasWaypoint(35)) yield* activateWaypoint(game, move)
      if (from === Area.FrozenTundra && !game.hasWaypoint(36)) yield* activateWaypoint(game, move)
      if (from === Area.AncientsWay && !game.hasWaypoint(37)) yield* activateWaypoint(game, move)

      yield* moveToExit(game, atk, pickit, to)
      return
    }
  }

  // ── Arreat Summit (Ancients) ──
  if (game.area === Area.ArreatSummit) {
    game.log('[a5] Ancients fight!')
    // Interact with altar to start the fight
    yield* interactQuestObject(game, atk, pickit, 2, 546) // altar
    yield* game.delay(2000)
    // Kill Ancients: Madawc=540, Talic=541, Korlic=542
    for (const bossId of [540, 541, 542]) {
      yield* killQuestBoss(game, atk, pickit, bossId)
    }
    game.log('[a5] Ancients defeated!')
    return
  }

  // ── Worldstone Keep ──
  const wsChain = [
    [Area.WorldstoneLvl1, Area.WorldstoneLvl2],
    [Area.WorldstoneLvl2, Area.WorldstoneLvl3],
    [Area.WorldstoneLvl3, Area.ThroneofDestruction],
  ] as const

  for (const [from, to] of wsChain) {
    if (game.area === from) {
      if (from === Area.WorldstoneLvl2 && !game.hasWaypoint(38)) yield* activateWaypoint(game, move)
      yield* moveToExit(game, atk, pickit, to)
      return
    }
  }

  // ── Throne of Destruction ──
  if (game.area === Area.ThroneofDestruction) {
    game.log('[a5] Throne of Destruction — clearing waves')
    // Walk to throne safe spot
    yield* moveTo(game, atk, pickit, 15106, 5040)

    // Clear 5 waves — each wave spawns specific monster classids
    const waveClassids = [
      [23, 62],   // Wave 1: Colenzo
      [105, 381], // Wave 2: Achmel
      [557],      // Wave 3: Bartuc
      [558],      // Wave 4: Ventar
      [571],      // Wave 5: Lister
    ]

    for (let wave = 0; wave < 5; wave++) {
      game.log('[a5] waiting for wave ' + (wave + 1))
      // Wait for wave to spawn
      for (let t = 0; t < 300; t++) {
        yield
        const waveMonster = game.monsters.find(m =>
          m.isAttackable && waveClassids[wave]!.includes(m.classid)
        )
        if (waveMonster) {
          game.log('[a5] wave ' + (wave + 1) + ' spawned')
          // Kill all wave monsters
          for (let casts = 0; casts < 200; casts++) {
            const remaining = game.monsters.find(m =>
              m.isAttackable && m.distance < 30
            )
            if (!remaining) break
            yield* atk.clear({ killRange: 30, maxCasts: 10 })
            yield
          }
          break
        }
      }
    }

    game.log('[a5] all waves cleared')
    // Wait for Baal to leave
    yield* game.delay(3000)
    // Portal to Worldstone Chamber should appear
    yield* moveToExit(game, atk, pickit, Area.WorldstoneChamber)
    return
  }

  // ── Worldstone Chamber (Baal) ──
  if (game.area === Area.WorldstoneChamber) {
    game.log('[a5] Baal fight!')
    yield* moveTo(game, atk, pickit, 15134, 5923)
    yield* killQuestBoss(game, atk, pickit, BAAL)
    game.log('[a5] BAAL DEFEATED! Normal complete!')
    return
  }

  // ── Side areas ──
  const sideAreas = [
    Area.FrozenRiver, Area.DrifterCavern, Area.IcyCellar,
    Area.NihlathaksTemple, Area.HallsofAnguish, Area.HallsofPain, Area.HallsofVaught,
    Area.Abaddon, Area.PitofAcheron, Area.InfernalPit,
  ]
  if (sideAreas.includes(game.area)) {
    const exits = game.getExits()
    if (exits.length > 0) yield* moveTo(game, atk, pickit, exits[0]!.x, exits[0]!.y)
    return
  }

  game.log('[a5] unknown area ' + game.area)
  game.exitGame()
}
