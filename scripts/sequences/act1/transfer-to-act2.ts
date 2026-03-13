import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Town } from "../../services/town.js"

const WARRIV_CLASSID = 155

/**
 * Transfer to Act 2 — talk to Warriv in Rogue Encampment and go east.
 */
export const TransferToAct2 = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const town = svc.get(Town)

  game.log('[transfer-act2] starting')

  yield* town.goToTown()

  // Find and interact with Warriv
  const warriv = game.objects.find(o => o.classid === WARRIV_CLASSID)
  if (!warriv) {
    game.log('[transfer-act2] Warriv not found')
    return
  }

  yield* move.walkTo(warriv.x, warriv.y)
  game.interact(warriv)
  yield* game.delay(500)

  // Select "Go East" menu option (menu id 0x0D = 13)
  game.sendPacket(new Uint8Array([0x38, 0x0D, 0x00, 0x00, 0x00]))
  yield* game.delay(1000)

  game.log('[transfer-act2] transferred to Act 2')
})
