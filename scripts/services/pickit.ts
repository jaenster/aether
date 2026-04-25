import { createService, type Game } from "diablo:game"
import { Config } from "../config.js"
import { matchItemNip, type PickitMatch } from "../lib/pickit-checker.js"

const GROUND = 5 // ItemContainer.Ground

export const Pickit = createService((game: Game, services) => {
  const cfg = services.get(Config)

  const failedItems = new Set<number>()
  let failedClearTick = 0

  return {
    *lootGround() {
      if (game._frame - failedClearTick > 500) {
        failedItems.clear()
        failedClearTick = game._frame
      }

      const candidates: Array<{ item: ReturnType<typeof game.items.filter>[number]; match: PickitMatch }> = []
      for (const i of game.items) {
        if (i.location !== GROUND) continue
        if (i.distance >= cfg.pickRange) continue
        if (failedItems.has(i.unitId)) continue
        const m = matchItemNip(i, game)
        if (m.verdict === 0) continue
        candidates.push({ item: i, match: m })
      }

      if (candidates.length > 0) {
        game.log('[pick] ' + candidates.length + ' items to pick up')
      }

      for (const { item, match } of candidates) {
        // Walk right on top of the item
        if (item.distance > 2) {
          game.move(item.x, item.y)
          for (let t = 0; t < 40; t++) {
            yield
            if (t % 8 === 0) game.move(item.x, item.y)
            if (item.distance <= 2) break
          }
        }

        const goldBefore = game.gold
        const where = match.file ? ' (' + match.file + ':' + match.line + ')' : ''
        const rule = match.rule ? ' rule=' + match.rule : ''
        game.log('[pick] pick ' + (item.name ?? item.code) + ' id=' + item.unitId + ' dist=' + (item.distance|0) + ' gold=' + goldBefore + where + rule)

        // Send pickup packet (0x16) — same as Ryuk FastPick
        game.clickItem(2, item.unitId)
        yield* game.delay(500)

        const goldAfter = game.gold
        if (goldAfter > goldBefore) {
          game.log('[pick] GOT GOLD! ' + goldBefore + ' → ' + goldAfter)
        }

        const still = game.items.find(i => i.unitId === item.unitId && i.location === GROUND)
        if (still) {
          failedItems.add(item.unitId)
        }
      }
    },
  }
})
