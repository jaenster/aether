import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"

const EXPERIENCE_SHRINE_CLASSID = 2 // Object type for experience shrines

/**
 * Shriner — search Act 1 areas for Experience shrines and activate them.
 */
export const Shriner = createScript(function*(game, svc) {
  const move = svc.get(Movement)

  game.log('[shriner] starting')

  const areas = [
    Area.BloodMoor,
    Area.ColdPlains,
    Area.StonyField,
    Area.DarkWood,
    Area.BlackMarsh,
  ]

  for (const area of areas) {
    yield* move.journeyTo(area)

    // Look for shrines in the area
    const shrines = game.objects.filter(o =>
      o.mode === 0 && o.classid >= 2 && o.classid <= 6 // shrine classid range
    )

    for (const shrine of shrines) {
      game.log(`[shriner] found shrine classid=${shrine.classid} at ${shrine.x},${shrine.y}`)
      yield* move.moveTo(shrine.x, shrine.y)
      game.interact(shrine)
      yield* game.delay(300)
    }
  }

  game.log('[shriner] complete')
})
