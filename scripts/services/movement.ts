import { createService, type Game, Area } from "diablo:game"
import { Config, townAreas } from "../config.js"
import { findBestWaypoint, waypointClassIds } from "../lib/waypoints.js"

export const Movement = createService((game: Game, services) => {
  const cfg = services.get(Config)

  function dist(x1: number, y1: number, x2: number, y2: number) {
    const dx = x1 - x2, dy = y1 - y2
    return Math.sqrt(dx * dx + dy * dy)
  }

  return {
    *teleportTo(targetX: number, targetY: number) {
      for (let attempts = 0; attempts < 50; attempts++) {
        const px = game.player.x, py = game.player.y
        const d = dist(px, py, targetX, targetY)
        if (d < 5) return

        if (d <= cfg.teleRange) {
          game.useSkill(cfg.teleport, targetX, targetY)
        } else {
          const ratio = cfg.teleRange / d
          game.useSkill(cfg.teleport,
            Math.floor(px + (targetX - px) * ratio),
            Math.floor(py + (targetY - py) * ratio))
        }
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

    *takeExit(areaId: number) {
      const exits = game.getExits()
      const exit = exits.find(e => e.area === areaId)
      if (!exit) {
        game.log(`[move] no exit to area ${areaId}`)
        return false
      }
      yield* this.moveTo(exit.x, exit.y)

      // Find the tile unit and interact, or click the exit position
      const tile = game.tiles.find(t => t.destArea === areaId)
      if (tile) {
        game.interact(tile)
      } else {
        game.clickMap(0, exit.x, exit.y)
      }

      // Wait for area transition
      for (let i = 0; i < 50; i++) {
        yield* game.delay(100)
        if (game.area === areaId) return true
      }
      game.log(`[move] exit transition timed out`)
      return false
    },

    // Find a waypoint in the current area by scanning presets for known classids
    findWaypointPreset() {
      for (const classid of waypointClassIds) {
        const pos = game.findPreset(2, classid)
        if (pos) return { classid, ...pos }
      }
      return null
    },

    // Find the live waypoint unit near a position
    findWaypointUnit(nearX: number, nearY: number) {
      const wpSet = new Set(waypointClassIds)
      return game.objects.find(obj =>
        wpSet.has(obj.classid) && dist(obj.x, obj.y, nearX, nearY) < 15
      ) ?? null
    },

    *useWaypoint(destArea: Area) {
      // Find waypoint preset in current area
      const preset = this.findWaypointPreset()
      if (!preset) {
        game.log(`[move] no waypoint preset in area ${game.area}`)
        return false
      }

      // Move to the waypoint
      yield* this.moveTo(preset.x, preset.y)

      // Find the live unit and interact
      const wpUnit = this.findWaypointUnit(preset.x, preset.y)
      if (!wpUnit) {
        game.log(`[move] waypoint unit not found near ${preset.x},${preset.y}`)
        return false
      }

      game.interact(wpUnit)
      yield* game.delay(500)

      // Send waypoint travel packet
      game.log(`[move] waypoint → area ${destArea} (wpUnit=${wpUnit.unitId})`)
      game.takeWaypoint(wpUnit.unitId, destArea)

      // Wait for area transition
      for (let i = 0; i < 50; i++) {
        yield* game.delay(100)
        const curArea = game.area
        if (curArea === destArea) {
          game.log(`[move] waypoint travel succeeded, now in area ${curArea}`)
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

      // Take waypoint if needed
      if (game.area !== route.wpArea) {
        const ok: unknown = yield* this.useWaypoint(route.wpArea)
        if (!ok) return
      }

      // Follow exits
      for (const nextArea of route.exitPath) {
        const ok: unknown = yield* this.takeExit(nextArea)
        if (!ok) return
      }

      game.log(`[move] arrived at area ${targetArea}`)
    },
  }
})
