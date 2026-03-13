import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Pickit } from "../../services/pickit.js"

/**
 * Lower Kurast / Kurast chests — open super chests in Lower Kurast,
 * Kurast Bazaar, and Upper Kurast for rune drops.
 */
export const LowerKurast = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const loot = svc.get(Pickit)

  game.log('[lower-kurast] starting')

  // Lower Kurast chests
  yield* move.journeyTo(Area.LowerKurast)
  game.log('[lower-kurast] opening chests in Lower Kurast')
  yield* openChests(game, move, loot)

  // Kurast Bazaar chests
  yield* move.journeyTo(Area.KurastBazaar)
  game.log('[lower-kurast] opening chests in Kurast Bazaar')
  yield* openChests(game, move, loot)

  // Upper Kurast chests
  yield* move.journeyTo(Area.UpperKurast)
  game.log('[lower-kurast] opening chests in Upper Kurast')
  yield* openChests(game, move, loot)

  game.log('[lower-kurast] complete')
})

function* openChests(game: any, move: any, loot: any) {
  // Find all chest objects in the area and open them
  const chests = game.objects.filter((o: any) =>
    o.mode === 0 && (o.classid >= 580 || o.name?.toLowerCase().includes('chest'))
  )
  for (const chest of chests) {
    yield* move.moveTo(chest.x, chest.y)
    game.interact(chest)
    yield* game.delay(300)
    yield* loot.lootGround()
  }
}
