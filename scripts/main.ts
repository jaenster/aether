import { createBot } from "diablo:game"
import { Chicken } from "./threads/chicken.js"
import { Mephisto } from "./sequences/mephisto.js"
// import {Chaos} from "./sequences/chaos.js";

export default createBot('sorc-farmer', function*(game, svc) {
  game.load.inGame(Chicken)

  // Debug: log S2C packets for level warps (0x09) to understand portal mechanics
  game.onPacket(0x09, (data) => {
    // 0x09 AssignLvlWarp: [op:1, type:1, id:4, classId:2(?), x:2, y:2, ...]
    if (data.length >= 7) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const unitType = data[1]!
      const unitId = view.getUint32(2, true)
      game.log(`[pkt] 0x09 AssignWarp: type=${unitType} id=${unitId} len=${data.length}`)
    }
  })

  while (true) {
    while (!game.inGame) yield
    yield* Mephisto.factory(game, svc)
    game.exitGame()
    while (game.inGame) yield
    yield* game.delay(2000)
  }
})
