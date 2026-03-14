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
    /** Yield frame-by-frame until position changes or maxFrames exceeded. */
    *waitForMove(maxFrames = 20) {
      const px = game.player.x, py = game.player.y
      yield // let action register
      for (let f = 0; f < maxFrames; f++) {
        yield
        if (game.player.x !== px || game.player.y !== py) return true
      }
      return false
    },

    *teleportTo(targetX: number, targetY: number, threshold = 5) {
      if (dist(game.player.x, game.player.y, targetX, targetY) < threshold) return

      const d = dist(game.player.x, game.player.y, targetX, targetY)
      const path = game.findTelePath(targetX, targetY)
      if (path.length === 0) {
        // game.log(`[move] no tele path to ${targetX},${targetY} dist=${d|0}`)
        return
      }
      // game.log(`[move] tele ${path.length} hops, dist=${d|0} from=${game.player.x},${game.player.y} to=${targetX},${targetY}`)

      // Select teleport skill — just switch, do NOT cast
      game.selectSkill(cfg.teleport)
      yield
      for (let i = 0; i < 20; i++) {
        if (game.player.canCast) break
        yield
      }
      let totalCasts = 0
      for (let wi = 0; wi < path.length; wi++) {
        const wp = path[wi]!
        const hopDist = dist(game.player.x, game.player.y, wp.x, wp.y)

        if (hopDist < threshold) {
          // game.log(`[move] hop ${wi}/${path.length} SKIP close (d=${hopDist|0}) wp=${wp.x},${wp.y}`)
          continue
        }

        // Skip if closer to next waypoint already
        if (wi + 1 < path.length) {
          const next = path[wi + 1]!
          if (dist(game.player.x, game.player.y, next.x, next.y) < hopDist) {
            // game.log(`[move] hop ${wi}/${path.length} SKIP closer-to-next wp=${wp.x},${wp.y}`)
            continue
          }
        }

        // Re-select teleport if skill changed — just switch, do NOT cast
        if (game.rightSkill !== cfg.teleport) {
          game.selectSkill(cfg.teleport)
          yield* game.delay(150)
        }

        // game.log(`[move] hop ${wi}/${path.length} d=${hopDist|0} me=${game.player.x},${game.player.y} → ${wp.x},${wp.y}`)
        for (let retries = 0; retries < 3; retries++) {
          totalCasts++
          // game.log(`[move] CAST #${totalCasts} tele → ${wp.x},${wp.y} (hop ${wi} try ${retries}) me=${game.player.x},${game.player.y}`)
          game.castSkillPacket(wp.x, wp.y)
          const moved: unknown = yield* this.waitForMove()
          if (moved) break
          // if (retries === 2) game.log(`[move] hop ${wi} FAILED: stuck at ${game.player.x},${game.player.y}`)
        }
      }

      // Final approach — cast directly to destination, abort if stuck
      let prevFinalDist = Infinity
      for (let i = 0; i < 3; i++) {
        const fd = dist(game.player.x, game.player.y, targetX, targetY)
        if (fd < threshold) break
        if (fd >= prevFinalDist) {
          // game.log(`[move] final approach stuck at d=${fd|0}, aborting`)
          break
        }
        prevFinalDist = fd
        totalCasts++
        // game.log(`[move] CAST #${totalCasts} final → ${targetX},${targetY} me=${game.player.x},${game.player.y} d=${fd|0}`)
        game.castSkillPacket(targetX, targetY)
        yield* this.waitForMove()
      }
      // game.log(`[move] tele done: ${totalCasts} casts for ${path.length} hops`)
    },

    *walkTo(targetX: number, targetY: number) {
      const path = game.findPath(targetX, targetY)
      if (path.length === 0) {
        // game.log(`[move] walkTo: no path to ${targetX},${targetY} from ${game.player.x},${game.player.y}`)
        return
      }

      for (const wp of path) {
        for (let ticks = 0; ticks < 50; ticks++) {
          const d = dist(game.player.x, game.player.y, wp.x, wp.y)
          if (d < 5) break

          // Take small steps — click max 10 tiles at a time to avoid wall clicks
          let clickX = wp.x, clickY = wp.y
          if (d > 10) {
            const ratio = 10 / d
            clickX = Math.round(game.player.x + (wp.x - game.player.x) * ratio)
            clickY = Math.round(game.player.y + (wp.y - game.player.y) * ratio)
          }

          game.move(clickX, clickY)
          yield* game.delay(80)
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
        // game.log(`[move] no exit to area ${areaId}`)
        return false
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        const d = dist(game.player.x, game.player.y, exit.x, exit.y)

        // If far, teleport to exit
        if (d > 10) {
          yield* this.teleportTo(exit.x, exit.y, 7)
          // If still far, re-path next attempt
          if (dist(game.player.x, game.player.y, exit.x, exit.y) > 20) continue
        }

        // Walk the last few tiles to trigger the exit
        for (let step = 0; step < 15; step++) {
          if (dist(game.player.x, game.player.y, exit.x, exit.y) < 3) break
          game.move(exit.x, exit.y)
          yield* game.delay(100)
          if (game.area === areaId) return true
        }

        // Find warp tile unit for our target area and interact
        const tile = game.tiles.find(t => t.destArea === areaId)
        if (tile) {
          game.interact(tile)
        } else {
          // game.log(`[move] no tile unit for area ${areaId}`)
        }

        if (yield* game.waitForArea(areaId)) return true
      }
      // game.log(`[move] exit to area ${areaId} timed out`)
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
        // game.log(`[move] no waypoint preset in area ${game.area}`)
        return false
      }

      // Walk to preset first (loads the area/rooms so the unit becomes visible)
      yield* this.moveTo(preset.x, preset.y)

      const wpUnit = this.findWaypointUnit(preset.x, preset.y)
      if (!wpUnit) {
        // game.log(`[move] waypoint unit not found near ${preset.x},${preset.y}`)
        return false
      }

      // If unit is offset from preset, walk the rest of the way
      const d = dist(game.player.x, game.player.y, wpUnit.x, wpUnit.y)
      if (d > 5) {
        yield* this.moveTo(wpUnit.x, wpUnit.y)
      }

      game.interact(wpUnit)
      yield* game.delay(500)

      // game.log(`[move] waypoint → area ${destArea} (wpUnit=${wpUnit.unitId})`)
      game.takeWaypoint(wpUnit.unitId, destArea)

      if (yield* game.waitForArea(destArea, 200)) {
        // game.log(`[move] waypoint travel succeeded, now in area ${game.area}`)
        return true
      }
      throw new Error(`[move] waypoint travel failed (still in area ${game.area}, target was ${destArea})`)
    },

    *journeyTo(targetArea: Area) {
      if (game.area === targetArea) return

      const route = findBestWaypoint(targetArea)
      if (!route) {
        throw new Error(`[move] no route to area ${targetArea} from ${game.area}`)
      }

      if (game.area !== route.wpArea) {
        const ok: unknown = yield* this.useWaypoint(route.wpArea)
        if (!ok) throw new Error(`[move] waypoint to ${route.wpArea} failed`)
      }

      for (const nextArea of route.exitPath) {
        const ok: unknown = yield* this.takeExit(nextArea)
        if (!ok) throw new Error(`[move] exit to area ${nextArea} failed (journey to ${targetArea})`)
      }
    },
  }
})
