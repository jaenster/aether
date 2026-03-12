import { createService, type Game, Area } from "diablo:game"
import { Config, townAreas } from "../config.js"
import { findBestWaypoint, waypointClassIds } from "../lib/waypoints.js"

function dist(x1: number, y1: number, x2: number, y2: number) {
  const dx = x1 - x2, dy = y1 - y2
  return Math.sqrt(dx * dx + dy * dy)
}

export const Movement = createService((game: Game, services) => {
  const cfg = services.get(Config)

  return {
    *teleportTo(targetX: number, targetY: number, threshold = 5) {
      if (dist(game.player.x, game.player.y, targetX, targetY) < threshold) return

      const path = game.findTelePath(targetX, targetY)
      if (path.length === 0) {
        game.log(`[move] no tele path to ${targetX},${targetY}`)
        return
      }

      for (const wp of path) {
        for (let retries = 0; retries < 5; retries++) {
          if (dist(game.player.x, game.player.y, wp.x, wp.y) < threshold) break

          const px = game.player.x, py = game.player.y
          game.useSkill(cfg.teleport, wp.x, wp.y)
          yield* game.delay(200)

          const nx = game.player.x, ny = game.player.y
          if (nx === px && ny === py) continue // didn't move, retry
        }
      }

      // Final approach — keep teleporting until within threshold
      for (let i = 0; i < 5; i++) {
        if (dist(game.player.x, game.player.y, targetX, targetY) < threshold) break
        game.useSkill(cfg.teleport, targetX, targetY)
        yield* game.delay(200)
      }
    },

    *walkTo(targetX: number, targetY: number) {
      const path = game.findPath(targetX, targetY)
      if (path.length === 0) return

      for (const wp of path) {
        for (let ticks = 0; ticks < 30; ticks++) {
          if (dist(game.player.x, game.player.y, wp.x, wp.y) < 5) break
          game.move(wp.x, wp.y)
          yield* game.delay(100)
        }
      }
    },

    *moveTo(targetX: number, targetY: number) {
      if (townAreas.has(game.area)) {
        yield* this.walkTo(targetX, targetY)
      } else {
        yield* this.teleportTo(targetX, targetY)
      }
    },

    /** Teleport/walk near a target, stopping at `range` tiles distance. */
    *moveNear(targetX: number, targetY: number, range: number) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const d = dist(game.player.x, game.player.y, targetX, targetY)
        if (d <= range + 2) return

        if (range <= 5) {
          // Short range: teleport directly onto the target
          yield* this.teleportTo(targetX, targetY, range + 2)
        } else {
          // Long range: approach to within range
          const dx = targetX - game.player.x
          const dy = targetY - game.player.y
          const ratio = (d - range) / d
          yield* this.moveTo(
            Math.round(game.player.x + dx * ratio),
            Math.round(game.player.y + dy * ratio)
          )
        }
      }
    },

    *takeExit(areaId: number) {
      const exits = game.getExits()
      const exit = exits.find(e => e.area === areaId)
      if (!exit) {
        game.log(`[move] no exit to area ${areaId}`)
        return false
      }

      // Teleport close to exit
      yield* this.teleportTo(exit.x, exit.y, 5)

      for (let attempt = 0; attempt < 5; attempt++) {
        // If still far, direct teleport
        if (dist(game.player.x, game.player.y, exit.x, exit.y) > 8) {
          game.useSkill(cfg.teleport, exit.x, exit.y)
          yield* game.delay(200)
        }

        // Walk the last few tiles
        for (let step = 0; step < 15; step++) {
          if (dist(game.player.x, game.player.y, exit.x, exit.y) < 5) break
          game.move(exit.x, exit.y)
          yield* game.delay(100)
          if (game.area === areaId) return true
        }

        // Find warp tile unit for our target area and interact
        const tile = game.tiles.find(t => t.destArea === areaId)
        if (tile) {
          game.interact(tile)
        }

        for (let i = 0; i < 30; i++) {
          yield* game.delay(100)
          if (game.area === areaId) return true
        }
      }
      game.log(`[move] exit to area ${areaId} timed out`)
      return false
    },

    findWaypointPreset() {
      for (const classid of waypointClassIds) {
        const pos = game.findPreset(2, classid)
        if (pos) return { classid, ...pos }
      }
      return null
    },

    findWaypointUnit(nearX: number, nearY: number) {
      const wpSet = new Set(waypointClassIds)
      return game.objects.find(obj =>
        wpSet.has(obj.classid) && dist(obj.x, obj.y, nearX, nearY) < 15
      ) ?? null
    },

    *useWaypoint(destArea: Area) {
      const preset = this.findWaypointPreset()
      if (!preset) {
        game.log(`[move] no waypoint preset in area ${game.area}`)
        return false
      }

      yield* this.moveTo(preset.x, preset.y)

      const wpUnit = this.findWaypointUnit(preset.x, preset.y)
      if (!wpUnit) {
        game.log(`[move] waypoint unit not found near ${preset.x},${preset.y}`)
        return false
      }

      game.interact(wpUnit)
      yield* game.delay(500)

      game.log(`[move] waypoint → area ${destArea} (wpUnit=${wpUnit.unitId})`)
      game.takeWaypoint(wpUnit.unitId, destArea)

      for (let i = 0; i < 50; i++) {
        yield* game.delay(100)
        if (game.area === destArea) {
          game.log(`[move] waypoint travel succeeded, now in area ${game.area}`)
          return true
        }
      }
      game.log(`[move] waypoint travel timed out (still in area ${game.area})`)
      return false
    },

    *journeyTo(targetArea: Area) {
      if (game.area === targetArea) return

      game.log(`[move] journeyTo ${targetArea} from area ${game.area}`)

      const route = findBestWaypoint(targetArea)
      if (!route) {
        game.log(`[move] no route to area ${targetArea}`)
        return
      }

      if (game.area !== route.wpArea) {
        const ok: unknown = yield* this.useWaypoint(route.wpArea)
        if (!ok) return
      }

      for (const nextArea of route.exitPath) {
        const ok: unknown = yield* this.takeExit(nextArea)
        if (!ok) return
      }

      game.log(`[move] arrived at area ${targetArea}`)
    },
  }
})
