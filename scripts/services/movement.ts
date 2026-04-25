import { createService, type Game, Area, Line } from "diablo:game"
import { takeScreenshot } from "diablo:native"
import { Config, townAreas } from "../config.js"
import { findBestWaypoint, waypointClassIds } from "../lib/waypoints.js"

function dist(x1: number, y1: number, x2: number, y2: number) {
  const dx = x1 - x2, dy = y1 - y2
  return Math.sqrt(dx * dx + dy * dy)
}

// Maggot Lair areas — use longer teleport distance
const MAGGOT_LAIR = new Set([62, 63, 64])

export const Movement = createService((game: Game, services) => {
  const cfg = services.get(Config)

  // Stuck detection state
  let stuckRetries = 0
  let lastStuckX = 0
  let lastStuckY = 0

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
      const startD = dist(game.player.x, game.player.y, targetX, targetY)
      if (startD < threshold) return

      game.log(`[move] tele to ${targetX},${targetY} dist=${startD|0} from=${game.player.x},${game.player.y}`)
      const path = game.findTelePath(targetX, targetY)
      if (path.length === 0) {
        game.log(`[move] no tele path to ${targetX},${targetY} dist=${startD|0}`)
        return
      }
      game.log(`[move] path: ${path.length} hops`)

      // Draw path on automap
      const pathLines: Line[] = []
      let prevX = game.player.x, prevY = game.player.y
      for (const wp of path) {
        pathLines.push(new Line({ x: prevX, y: prevY, x2: wp.x, y2: wp.y, color: 0xFF, automap: true }))
        prevX = wp.x; prevY = wp.y
      }

      // Let one frame render the path lines, then screenshot
      yield
      if (pathLines.length > 5) takeScreenshot()

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
          if (pathLines[wi]) pathLines[wi]!.remove()
          continue
        }

        // Skip if closer to next waypoint already
        if (wi + 1 < path.length) {
          const next = path[wi + 1]!
          if (dist(game.player.x, game.player.y, next.x, next.y) < hopDist) {
            if (pathLines[wi]) pathLines[wi]!.remove()
            continue
          }
        }

        // Re-select teleport if skill changed — just switch, do NOT cast
        if (game.rightSkill !== cfg.teleport) {
          game.selectSkill(cfg.teleport)
          yield* game.delay(150)
        }

        for (let retries = 0; retries < 3; retries++) {
          totalCasts++
          game.castSkillPacket(wp.x, wp.y)
          const moved: unknown = yield* this.waitForMove()
          if (moved) break
        }
        if (pathLines[wi]) pathLines[wi]!.remove()
      }

      // Final approach — cast directly to destination, abort if stuck
      let prevFinalDist = Infinity
      for (let i = 0; i < 3; i++) {
        const fd = dist(game.player.x, game.player.y, targetX, targetY)
        if (fd < threshold) break
        if (fd >= prevFinalDist) break
        prevFinalDist = fd
        totalCasts++
        game.castSkillPacket(targetX, targetY)
        yield* this.waitForMove()
      }
      // Clean up any remaining path lines
      for (const l of pathLines) l.remove()
    },

    *walkTo(targetX: number, targetY: number) {
      let path = game.findPath(targetX, targetY)
      if (path.length === 0) return

      let repathCount = 0
      const MAX_REPATHS = 3

      for (let wi = 0; wi < path.length; wi++) {
        const wp = path[wi]!

        // Skip waypoints we're already past (closer to next than current)
        if (wi + 1 < path.length) {
          const dCur = dist(game.player.x, game.player.y, wp.x, wp.y)
          const dNext = dist(game.player.x, game.player.y, path[wi + 1]!.x, path[wi + 1]!.y)
          if (dNext < dCur && dNext < 10) continue
        }

        let stuckCount = 0
        let lastX = game.player.x, lastY = game.player.y

        for (let ticks = 0; ticks < 80; ticks++) {
          const d = dist(game.player.x, game.player.y, wp.x, wp.y)
          if (d < 5) break

          // Small steps — cap at 10 tiles to avoid clicking through walls
          let clickX = wp.x, clickY = wp.y
          if (d > 10) {
            const ratio = 10 / d
            clickX = Math.round(game.player.x + (wp.x - game.player.x) * ratio)
            clickY = Math.round(game.player.y + (wp.y - game.player.y) * ratio)
          }

          game.move(clickX, clickY)
          yield* game.delay(80)

          // Stuck detection every ~20 ticks (~1.6s)
          if (ticks > 0 && ticks % 20 === 0) {
            const moved = dist(game.player.x, game.player.y, lastX, lastY)
            if (moved < 3) {
              stuckCount++

              if (stuckCount >= 2) {
                // Perpendicular sidestep (kolbot technique)
                const angle = Math.atan2(game.player.y - wp.y, game.player.x - wp.x)
                const side = stuckCount % 2 === 0 ? Math.PI / 2 : -Math.PI / 2
                const jx = Math.round(Math.cos(angle + side) * 5 + game.player.x)
                const jy = Math.round(Math.sin(angle + side) * 5 + game.player.y)
                game.log(`[walk] stuck ${stuckCount}x, sidestep to ${jx},${jy}`)
                game.move(jx, jy)
                yield* game.delay(400)
              }

              if (stuckCount >= 4) {
                // Re-path from current position
                if (repathCount < MAX_REPATHS) {
                  repathCount++
                  game.log(`[walk] re-pathing (${repathCount}/${MAX_REPATHS})`)
                  path = game.findPath(targetX, targetY)
                  if (path.length === 0) return
                  wi = -1 // restart loop (will increment to 0)
                  break
                } else {
                  game.log(`[walk] max re-paths, giving up`)
                  return
                }
              }
            } else {
              stuckCount = 0
            }
            lastX = game.player.x
            lastY = game.player.y
          }
        }
      }
    },

    *moveTo(targetX: number, targetY: number) {
      if (townAreas.has(game.area) || !cfg.canTeleport) {
        yield* this.walkTo(targetX, targetY)
      } else {
        yield* this.teleportTo(targetX, targetY)
      }
    },

    /** Move near a target, stopping at `range` tiles distance. */
    *moveNear(targetX: number, targetY: number, range: number) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const d = dist(game.player.x, game.player.y, targetX, targetY)
        if (d <= range + 2) return

        if (range <= 5 && cfg.canTeleport) {
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
        return false
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        const d = dist(game.player.x, game.player.y, exit.x, exit.y)

        // Move to exit — teleport if available, walk otherwise
        if (d > 10) {
          yield* this.moveTo(exit.x, exit.y)
          if (dist(game.player.x, game.player.y, exit.x, exit.y) > 20) continue
        }

        // Walk the last few tiles to trigger the exit
        for (let step = 0; step < 15; step++) {
          if (dist(game.player.x, game.player.y, exit.x, exit.y) < 3) break
          game.move(exit.x, exit.y)
          yield* game.delay(100)
          if (game.area === areaId) break
        }

        if (game.area === areaId) break

        // Find warp tile unit for our target area and interact
        const tile = game.tiles.find(t => t.destArea === areaId)
        if (tile) {
          game.interact(tile)
        }

        if (yield* game.waitForArea(areaId)) break
      }

      return game.area === areaId
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

      game.log(`[move] journey ${game.area}→${targetArea} via wp=${route.wpArea} exits=[${route.exitPath}]`)

      if (game.area !== route.wpArea) {
        const ok: unknown = yield* this.useWaypoint(route.wpArea)
        if (!ok) throw new Error(`[move] waypoint to ${route.wpArea} failed`)
      }

      for (const nextArea of route.exitPath) {
        // First try: teleport to exit and interact
        let ok: unknown = yield* this.takeExit(nextArea)
        if (ok) continue

        // For same-layer exits (outdoor→outdoor): the exit tile may be far.
        // Teleport around near the known exit coords to find it.
        const exits = game.getExits()
        const exit = exits.find(e => e.area === nextArea)
        if (exit) {
          game.log(`[move] searching for exit to area ${nextArea} near ${exit.x},${exit.y}`)
          const offsets = [[0,0],[20,0],[-20,0],[0,20],[0,-20],[20,20],[-20,-20],[30,0],[-30,0],[0,30],[0,-30]]
          for (const [dx, dy] of offsets) {
            yield* this.moveTo(exit.x + dx, exit.y + dy)
            ok = yield* this.takeExit(nextArea)
            if (ok || game.area === nextArea) break
          }
        }

        if (!ok && game.area !== nextArea) {
          throw new Error(`[move] exit to area ${nextArea} failed (journey to ${targetArea})`)
        }
      }
    },

    // ── Ryuk-ported additions ──────────────────────────────────────

    /** Teleport with stuck detection and angular retry.
     *  From Ryuk Pather.ts: ±90° angular offset retries, 3x limit,
     *  5-tile radius clear on 2nd fail. */
    *teleportWithRetry(targetX: number, targetY: number, threshold = 5) {
      const startX = game.player.x, startY = game.player.y

      yield* this.teleportTo(targetX, targetY, threshold)

      // Check if we actually moved
      const d = dist(game.player.x, game.player.y, targetX, targetY)
      if (d <= threshold) {
        stuckRetries = 0
        return true
      }

      // Stuck! Try angular offsets
      const moved = dist(game.player.x, game.player.y, startX, startY)
      if (moved < 3) {
        stuckRetries++
        game.log(`[move] stuck! retry ${stuckRetries}/3`)

        if (stuckRetries >= 4) {
          // Total stuck — give up
          stuckRetries = 0
          game.log(`[move] stuck 4x, giving up`)
          return false
        }

        // Try ±90° perpendicular offsets at 5-tile distance
        const dx = targetX - game.player.x
        const dy = targetY - game.player.y
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy))
        const perpX = -dy / len * 5
        const perpY = dx / len * 5
        const sign = stuckRetries % 2 === 0 ? 1 : -1

        const retryX = Math.round(game.player.x + perpX * sign)
        const retryY = Math.round(game.player.y + perpY * sign)

        game.log(`[move] trying perpendicular: ${retryX},${retryY}`)
        yield* this.teleportTo(retryX, retryY, 5)

        // On 2nd fail: try to clear the area
        if (stuckRetries >= 2) {
          game.log(`[move] clearing 5-tile radius`)
          // Walk in a small circle to unstick
          for (let angle = 0; angle < 4; angle++) {
            const ax = Math.round(game.player.x + Math.cos(angle * Math.PI / 2) * 3)
            const ay = Math.round(game.player.y + Math.sin(angle * Math.PI / 2) * 3)
            game.move(ax, ay)
            yield* game.delay(100)
          }
        }

        // Retry the original target
        yield* this.teleportTo(targetX, targetY, threshold)
        return dist(game.player.x, game.player.y, targetX, targetY) <= threshold
      }

      stuckRetries = 0
      return d <= threshold + 5 // close enough
    },

    /** Smart move: decide walk vs teleport based on distance ratio.
     *  From Ryuk Pather.ts: if walk distance > 2x straight-line, teleport.
     *  Also handles Maggot Lair (30 tele distance). */
    *smartMoveTo(targetX: number, targetY: number) {
      if (townAreas.has(game.area)) {
        yield* this.walkTo(targetX, targetY)
        return
      }

      const straightDist = dist(game.player.x, game.player.y, targetX, targetY)

      // Maggot Lair: always teleport
      if (MAGGOT_LAIR.has(game.area)) {
        yield* this.teleportWithRetry(targetX, targetY, 5)
        return
      }

      // Short distance: walk
      if (straightDist < 10) {
        yield* this.walkTo(targetX, targetY)
        return
      }

      // Check walk path distance vs straight line
      const walkPath = game.findPath(targetX, targetY)
      if (walkPath.length === 0) {
        // No walk path — must teleport
        yield* this.teleportWithRetry(targetX, targetY, 5)
        return
      }

      // Sum walk path distance
      let walkDist = 0
      let px = game.player.x, py = game.player.y
      for (const wp of walkPath) {
        walkDist += dist(px, py, wp.x, wp.y)
        px = wp.x
        py = wp.y
      }

      // If walk distance > 2x straight line, teleport instead
      if (walkDist > straightDist * 2) {
        yield* this.teleportWithRetry(targetX, targetY, 5)
      } else {
        yield* this.walkTo(targetX, targetY)
      }
    },

    /** Move along a path with integrated clearing.
     *  From Ryuk MoveTo.ts: node skipping when no monsters nearby,
     *  shrine detection hooks (deferred). */
    *moveWithClearing(
      targetX: number,
      targetY: number,
      clearRange = 25,
      clearFn?: () => Generator<void>,
    ) {
      const path = game.findTelePath(targetX, targetY)
      if (path.length === 0) {
        yield* this.teleportTo(targetX, targetY)
        return
      }

      game.selectSkill(cfg.teleport)
      yield

      for (let i = 0; i < path.length; i++) {
        const wp = path[i]!

        // Node skipping: if no monsters within clearRange of next few nodes, skip ahead
        if (i + 1 < path.length && !clearFn) {
          let hasMonsters = false
          for (const m of game.monsters) {
            if (!m.isAttackable) continue
            if (dist(m.x, m.y, wp.x, wp.y) < clearRange) {
              hasMonsters = true
              break
            }
          }
          if (!hasMonsters) continue // skip this node
        }

        // Teleport to node
        if (game.rightSkill !== cfg.teleport) {
          game.selectSkill(cfg.teleport)
          yield
        }
        game.castSkillPacket(wp.x, wp.y)
        yield* this.waitForMove()

        // Clear if there are monsters nearby
        if (clearFn) {
          let hasNearby = false
          for (const m of game.monsters) {
            if (m.isAttackable && m.distance < clearRange) {
              hasNearby = true
              break
            }
          }
          if (hasNearby) {
            yield* clearFn()
          }
        }
      }
    },
  }
})
