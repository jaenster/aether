import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"

/**
 * Ruined Temples — clear all 6 ruined temple sub-areas for XP and loot.
 *
 * Areas visited:
 *   Kurast Bazaar: Disused Fane, Ruined Temple
 *   Upper Kurast:  Forgotten Reliquary, Forgotten Temple
 *   Kurast Causeway: Disused Reliquary, Ruined Fane
 */
export const RuinedTemples = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[ruined-temples] starting')

  const templeGroups: { hub: Area, temples: Area[] }[] = [
    {
      hub: Area.KurastBazaar,
      temples: [Area.DisusedFane, Area.RuinedTemple],
    },
    {
      hub: Area.UpperKurast,
      temples: [Area.ForgottenReliquary, Area.ForgottenTemple],
    },
    {
      hub: Area.KurastCauseway,
      temples: [Area.DisusedReliquary, Area.RuinedFane],
    },
  ]

  for (const group of templeGroups) {
    for (const temple of group.temples) {
      game.log(`[ruined-temples] clearing ${temple}`)

      // Navigate to the hub area first
      yield* move.journeyTo(group.hub)

      // Enter the temple
      yield* move.takeExit(temple)

      // Clear monsters focusing on special/champion packs
      yield* atk.clear({ killRange: 25, maxCasts: 40 })
      yield* loot.lootGround()

      // Return to hub
      yield* move.takeExit(group.hub)
    }
  }

  game.log('[ruined-temples] complete')
})
