import { createService, type Game } from "diablo:game"
import { Config, townAreas } from "../config.js"

export const Movement = createService((game: Game, services) => {
  const cfg = services.get(Config)

  return {
    *teleportTo(targetX: number, targetY: number) {
      let attempts = 0
      while (attempts < 50) {
        const dx = targetX - game.me.x
        const dy = targetY - game.me.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 5) return

        if (dist <= cfg.teleRange) {
          game.useSkill(cfg.teleport, targetX, targetY)
        } else {
          const ratio = cfg.teleRange / dist
          game.useSkill(cfg.teleport,
            Math.floor(game.me.x + dx * ratio),
            Math.floor(game.me.y + dy * ratio))
        }
        attempts++
        yield* game.delay(200)
      }
    },

    *walkTo(targetX: number, targetY: number) {
      const path = game.findPath(targetX, targetY)
      if (path.length === 0) {
        game.log(`  walk: no path to ${targetX},${targetY}`)
        return
      }
      game.log(`  walk: ${path.length} nodes`)

      for (let i = 0; i < path.length; i++) {
        const wp = path[i]!
        let ticks = 0
        while (ticks < 30) {
          const dx = wp.x - game.me.x
          const dy = wp.y - game.me.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 5) break

          game.move(wp.x, wp.y)
          ticks++
          yield* game.delay(100)
        }
        if (i % 5 === 0) {
          game.log(`  walk: wp ${i}/${path.length} pos=${game.me.x},${game.me.y}`)
        }
      }
      game.log(`  walk: done at ${game.me.x},${game.me.y}`)
    },

    *moveTo(targetX: number, targetY: number) {
      if (townAreas.has(game.area)) {
        yield* this.walkTo(targetX, targetY)
      } else {
        yield* this.teleportTo(targetX, targetY)
      }
    },

    *takeExit(areaId: number) {
      const exits = game.getExits()
      const exit = exits.find(e => e.area === areaId)
      if (!exit) {
        game.log(`No exit to area ${areaId}`)
        return
      }
      game.log(`Taking exit to ${areaId} at ${exit.x},${exit.y}`)
      yield* this.walkTo(exit.x, exit.y)
      // Click the exit tile to enter
      game.clickMap(0, exit.x, exit.y)
      yield* game.delay(1500)
    },
  }
})
