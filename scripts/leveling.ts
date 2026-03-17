import { createBot, createScript, FormType, Area } from "diablo:game"
import { generateName } from "./lib/name-generator.js"
import { Town } from "./services/town.js"
import { Attack } from "./services/attack.js"
import { Movement } from "./services/movement.js"
import { AutoBuild } from "./services/auto-build.js"
import { BlizzSorc } from "./builds/sorc-blizz.js"
import { ThreatMonitor } from "./threads/threat-monitor.js"
import { Guard } from "./services/guard.js"
import { Chicken } from "./threads/chicken.js"
// import { clearArea, type ClearContext } from "./lib/area-clear.js"
import { Buffs } from "./services/buffs.js"
import { Pickit } from "./services/pickit.js"

const CHAR_CLASS = 1 // Sorceress
const townAreas = new Set([Area.RogueEncampment, Area.LutGholein, Area.KurastDocks, Area.PandemoniumFortress, Area.Harrogath])

interface BotState {
  charName: string
  classId: number
  runsCompleted: number
  lastArea: number
}

// Leveling zones by level range — clear these areas to gain XP
const levelingZones: { minLevel: number, maxLevel: number, area: number, name: string }[] = [
  // Act 1
  { minLevel: 1, maxLevel: 6, area: Area.BloodMoor, name: 'Blood Moor' },
  { minLevel: 3, maxLevel: 9, area: Area.ColdPlains, name: 'Cold Plains' },
  { minLevel: 5, maxLevel: 10, area: Area.StonyField, name: 'Stony Field' },
  { minLevel: 7, maxLevel: 13, area: Area.DarkWood, name: 'Dark Wood' },
  { minLevel: 8, maxLevel: 14, area: Area.BlackMarsh, name: 'Black Marsh' },
  { minLevel: 9, maxLevel: 15, area: Area.TamoeHighland, name: 'Tamoe Highland' },
  { minLevel: 10, maxLevel: 15, area: Area.OuterCloister, name: 'Outer Cloister' },
  // Act 2
  { minLevel: 14, maxLevel: 18, area: Area.RockyWaste, name: 'Rocky Waste' },
  { minLevel: 15, maxLevel: 19, area: Area.DryHills, name: 'Dry Hills' },
  { minLevel: 16, maxLevel: 20, area: Area.FarOasis, name: 'Far Oasis' },
  { minLevel: 17, maxLevel: 22, area: Area.LostCity, name: 'Lost City' },
  // Act 3
  { minLevel: 22, maxLevel: 26, area: Area.SpiderForest, name: 'Spider Forest' },
  { minLevel: 23, maxLevel: 27, area: Area.FlayerJungle, name: 'Flayer Jungle' },
  { minLevel: 24, maxLevel: 28, area: Area.LowerKurast, name: 'Lower Kurast' },
  { minLevel: 25, maxLevel: 29, area: Area.KurastBazaar, name: 'Kurast Bazaar' },
  // Act 4
  { minLevel: 27, maxLevel: 31, area: Area.OuterSteppes, name: 'Outer Steppes' },
  { minLevel: 28, maxLevel: 33, area: Area.PlainsofDespair, name: 'Plains of Despair' },
  { minLevel: 29, maxLevel: 34, area: Area.CityoftheDamned, name: 'City of the Damned' },
  // Act 5
  { minLevel: 33, maxLevel: 38, area: Area.BloodyFoothills, name: 'Bloody Foothills' },
  { minLevel: 34, maxLevel: 39, area: Area.FrigidHighlands, name: 'Frigid Highlands' },
  { minLevel: 35, maxLevel: 40, area: Area.ArreatPlateau, name: 'Arreat Plateau' },
  { minLevel: 36, maxLevel: 42, area: Area.FrozenTundra, name: 'Frozen Tundra' },
]

/** Find the best zone for the current level */
function getBestZone(level: number): typeof levelingZones[0] | null {
  // Prefer zones where we're in the middle of the range
  let best: typeof levelingZones[0] | null = null
  let bestScore = -1
  for (const zone of levelingZones) {
    if (level < zone.minLevel || level > zone.maxLevel) continue
    // Score: how centered we are in the range (higher = better XP)
    const mid = (zone.minLevel + zone.maxLevel) / 2
    const score = zone.maxLevel - level // prefer zones where we're below mid
    if (score > bestScore) {
      bestScore = score
      best = zone
    }
  }
  return best
}

const AutoAllocThread = createScript(function*(game, svc) {
  const ab = svc.get(AutoBuild)
  ab.setBuild(BlizzSorc)
  while (true) {
    yield* game.delay(2000)
    if (game.inGame) yield* ab.allocatePoints()
  }
})

const BuffThread = createScript(function*(game, svc) {
  const b = svc.get(Buffs)
  while (true) {
    yield* game.delay(5000)
    if (game.inGame && !townAreas.has(game.area)) {
      yield* b.refreshAll()
    }
  }
})

export default createBot('leveling', function*(game, svc) {
  // ── State management ──
  let state: BotState = game.readState<BotState>() ?? {
    charName: generateName(),
    classId: CHAR_CLASS,
    runsCompleted: 0,
    lastArea: 0,
  }
  if (!game.readState()) {
    game.writeState(state)
    game.log('[bot] new state: ' + state.charName)
  } else {
    game.log('[bot] loaded: ' + state.charName + ' (' + state.runsCompleted + ' runs)')
  }

  // ── OOG: Create/select char ──
  let phase = 'splash'
  while (!game.inGame) {
    yield
    const controls = game.getControls()
    const buttons = controls.filter(c => c.type === FormType.Button)

    if (phase === 'splash') {
      if (buttons.length > 0) { phase = 'main_menu'; continue }
      if (controls.length > 0) {
        const c = controls.find(c => c.type === FormType.TextBox || c.type === FormType.Image)
        if (c) game.clickControl(c.i)
      }
      yield* game.delay(500)
    } else if (phase === 'main_menu') {
      const sp = buttons.find(b => b.text?.includes('SINGLE'))
      if (sp) { game.clickControl(sp.i); phase = 'char_select'; yield* game.delay(1000) }
      yield* game.delay(500)
    } else if (phase === 'char_select') {
      if (game.oogSelectChar(state.charName)) {
        game.log('[bot] selected ' + state.charName)
        yield* game.delay(3000)
        continue
      }
      const create = buttons.find(b => b.text?.includes('CREATE'))
      if (create) { game.clickControl(create.i); phase = 'create'; yield* game.delay(1500) }
      yield* game.delay(500)
    } else if (phase === 'create') {
      game.oogSelectClass(CHAR_CLASS)
      yield* game.delay(500)
      const edit = controls.find(c => c.type === FormType.EditBox)
      if (edit) game.setControlText(edit.i, state.charName)
      yield* game.delay(300)
      // Handle popup
      const cancel = buttons.find(b => b.text?.includes('CANCEL'))
      if (cancel) {
        game.clickControl(cancel.i)
        state.charName = generateName(Date.now())
        game.writeState(state)
        game.log('[bot] name taken, trying: ' + state.charName)
        yield* game.delay(500)
        continue
      }
      const ok = buttons.find(b => b.text?.includes('OK') && b.state !== 0)
      if (ok) { game.clickControl(ok.i); yield* game.delay(5000) }
      yield* game.delay(500)
    }
  }

  game.log('[bot] IN GAME as ' + state.charName + ' level ' + game.charLevel)

  // ── Set up services ──
  game.load.inGame(ThreatMonitor)
  game.load.inGame(Guard)
  game.load.inGame(Chicken)
  game.load.inGame(AutoAllocThread)
  game.load.inGame(BuffThread)

  const town = svc.get(Town)
  const atk = svc.get(Attack)
  const move = svc.get(Movement)
  const buffs = svc.get(Buffs)
  const pickit = svc.get(Pickit)

  // ── Main game loop ──
  while (true) {
    while (!game.inGame) {
      yield
      // Re-enter game on disconnect
      if (!game.inGame) {
        const controls = game.getControls()
        const buttons = controls.filter(c => c.type === FormType.Button)
        // Try to select char if on char select
        if (buttons.find(b => b.text?.includes('OK'))) {
          if (game.oogSelectChar(state.charName)) yield* game.delay(3000)
        }
        // Click single player if on main menu
        const sp = buttons.find(b => b.text?.includes('SINGLE'))
        if (sp) { game.clickControl(sp.i); yield* game.delay(1000) }
        yield* game.delay(500)
      }
    }

    yield* game.run(function*() {
      const level = game.charLevel
      game.log('[bot] level ' + level + ' area ' + game.area)

      // Town chores if needed (heal, buy pots, repair)
      if (townAreas.has(game.area)) {
        yield* town.doTownChores()
      }

      // Find best leveling zone for our level
      const zone = getBestZone(level)
      if (!zone) {
        game.log('[bot] no suitable zone for level ' + level + ', idle')
        yield* game.delay(5000)
        return
      }

      game.log('[bot] heading to ' + zone.name + ' (area ' + zone.area + ')')

      // Navigate to the zone — walk to exit if in town
      if (game.area !== zone.area) {
        game.log('[bot] navigating from area ' + game.area + ' to ' + zone.area)
        try {
          yield* move.journeyTo(zone.area)
        } catch (e: any) {
          game.log('[bot] navigation failed: ' + (e.message || e))
          yield* game.delay(2000)
          return
        }
        // Verify we arrived
        if (game.area !== zone.area) {
          game.log('[bot] failed to reach ' + zone.name + ' (still in area ' + game.area + ')')
          yield* game.delay(2000)
          return
        }
      }

      // Don't attack in town
      if (townAreas.has(game.area)) {
        game.log('[bot] still in town, skipping')
        yield* game.delay(1000)
        return
      }

      // ── Scenic route: detour through far side of area, then walk to exit ──
      const exits = game.getExits()
      const progressExits = exits
        .filter(e => e.area > game.area)
        .sort((a, b) => a.area - b.area)
      const exit = progressExits[0] ?? exits[0]

      if (!exit) {
        game.log('[bot] no exits in ' + zone.name)
        game.move(game.player.x + 30, game.player.y)
        yield* game.delay(2000)
        return
      }

      // Find a detour point: farthest walkable tile that is roughly perpendicular
      // to the player→exit line. This creates a scenic L-shaped path through the area
      // instead of going backward toward town.
      const px = game.player.x, py = game.player.y
      const exDx = exit.x - px, exDy = exit.y - py
      const exDist = Math.sqrt(exDx * exDx + exDy * exDy)
      // Perpendicular direction (rotated 90°)
      const perpX = -exDy / Math.max(1, exDist)
      const perpY = exDx / Math.max(1, exDist)
      // Scan centered between player and exit (shifted forward into the area, away from town)
      const scanCx = Math.round(px + exDx * 0.4)
      const scanCy = Math.round(py + exDy * 0.4)
      const scanR = 40
      const collGrid = game.getCollisionRect(scanCx - scanR, scanCy - scanR, scanR * 2, scanR * 2)
      let farX = px, farY = py, bestScore = 0
      if (collGrid.length > 0) {
        for (let dy = 0; dy < scanR * 2; dy += 3) {
          for (let dx = 0; dx < scanR * 2; dx += 3) {
            const flags = collGrid[dy * scanR * 2 + dx]
            if (flags !== undefined && flags !== 0xFFFF && (flags & 1) === 0) {
              const wx = scanCx - scanR + dx
              const wy = scanCy - scanR + dy
              // Score: how far perpendicular to the exit direction + some forward bias
              const relX = wx - px, relY = wy - py
              const perpDot = Math.abs(relX * perpX + relY * perpY) // perpendicular distance
              const fwdDot = relX * exDx / exDist + relY * exDy / exDist // forward distance
              // Prefer perpendicular + slightly forward, reject backward
              if (fwdDot < -5) continue // don't go backward (toward town)
              const score = perpDot + fwdDot * 0.3
              if (score > bestScore) { bestScore = score; farX = wx; farY = wy }
            }
          }
        }
      }

      // Build scenic path: detour to far point first, then exit
      const detour = (bestScore > 15) ? game.findPath(farX, farY) : [] // only detour if far enough
      const path: { x: number, y: number }[] = []
      if (detour.length > 3) {
        path.push(...detour)
        game.log('[bot] ' + zone.name + ': scenic detour (' + detour.length + ' nodes) then exit area=' + exit.area)
      } else {
        game.log('[bot] ' + zone.name + ': straight to exit area=' + exit.area)
      }
      // Re-path to exit will happen after detour (from wherever we end up)

      if (path.length === 0) {
        const directPath = game.findPath(exit.x, exit.y)
        if (directPath.length === 0) {
          game.move(exit.x, exit.y)
          yield* game.delay(2000)
          return
        }
        path.push(...directPath)
      }

      // Walk node-by-node, fight after each step
      const startArea = game.area
      for (let i = 0; i < path.length; i++) {
        if (!game.inGame) break
        // Death check: mode 0/17 = dying/dead, or suddenly in town (respawned)
        if (game.player.mode === 0 || game.player.mode === 17 || game.player.hp <= 0
            || (townAreas.has(game.area) && !townAreas.has(startArea))) {
          game.log('[bot] DIED (mode=' + game.player.mode + ' hp=' + game.player.hp + ' area=' + game.area + ')')
          yield* game.delay(2000)
          return
        }
        const wp = path[i]!

        // Click to walk toward this node
        game.move(wp.x, wp.y)

        // Walk until close (click repeatedly, check every 4 frames)
        for (let t = 0; t < 50; t++) {
          yield
          // Re-click every ~8 frames to keep walking
          if (t % 8 === 0) game.move(wp.x, wp.y)

          const dx = game.player.x - wp.x
          const dy = game.player.y - wp.y
          if (dx * dx + dy * dy < 25) break // within 5 tiles

          // Death check mid-walk
          if (game.player.mode === 0 || game.player.mode === 17 || game.player.hp <= 0
              || (townAreas.has(game.area) && !townAreas.has(startArea))) {
            game.log('[bot] DIED mid-walk')
            return
          }

          // If HP low, kite away from monsters
          if (game.player.hp > 0 && game.player.hp < game.player.maxHp * 0.4) {
            // Run away from nearest monster
            for (const m of game.monsters) {
              if (m.isAttackable && m.distance < 10) {
                const dx = game.player.x - m.x
                const dy = game.player.y - m.y
                const d = Math.max(1, Math.sqrt(dx * dx + dy * dy))
                game.move(Math.round(game.player.x + dx / d * 10), Math.round(game.player.y + dy / d * 10))
                yield* game.delay(300)
                break
              }
            }
          }

          // If a monster is in range, stop walking and fight
          for (const m of game.monsters) {
            if (m.isAttackable && m.distance < 20) {
              yield* atk.clear({ killRange: 25, maxCasts: 8 })
              break
            }
          }
        }

        // After arriving at node: fight everything in range
        let monstersNearby = false
        for (const m of game.monsters) {
          if (m.isAttackable && m.distance < 25) { monstersNearby = true; break }
        }
        if (monstersNearby) {
          yield* atk.clear({ killRange: 25, maxCasts: 10 })
          yield* pickit.lootGround()
        }

        // node done
      }

      // After detour, path to exit
      if (detour.length > 3) {
        const exitPath = game.findPath(exit.x, exit.y)
        if (exitPath.length > 0) {
          for (let i = 0; i < exitPath.length; i++) {
            if (!game.inGame) break
            if (game.player.hp <= 0) { game.log('[bot] DIED'); yield* game.delay(3000); return }
            const wp = exitPath[i]!

            game.move(wp.x, wp.y)
            for (let t = 0; t < 50; t++) {
              yield
              if (t % 8 === 0) game.move(wp.x, wp.y)
              const dx = game.player.x - wp.x, dy = game.player.y - wp.y
              if (dx * dx + dy * dy < 25) break
              for (const m of game.monsters) {
                if (m.isAttackable && m.distance < 20) {
                  yield* atk.clear({ killRange: 25, maxCasts: 8 })
                  break
                }
              }
            }
            // node done

            let monstersNearby = false
            for (const m of game.monsters) {
              if (m.isAttackable && m.distance < 25) { monstersNearby = true; break }
            }
            if (monstersNearby) {
              yield* atk.clear({ killRange: 25, maxCasts: 10 })
              yield* pickit.lootGround()
              yield* build.allocatePoints()
            }
          }
        }
      }

      game.log('[bot] reached exit in ' + zone.name)

      // Allocate any new skill/stat points from leveling
      yield* build.allocatePoints()

      state.runsCompleted++
      state.lastArea = zone.area
      game.writeState(state)
      game.log('[bot] cleared ' + zone.name + ' (run ' + state.runsCompleted + ', level ' + game.charLevel + ')')

      // Go back to town
      try {
        yield* town.goToTown()
      } catch {
        // If no TP, try waypoint
        game.log('[bot] no TP, saving and exiting')
        game.exitGame()
      }
    }())

    // Left game — wait and re-enter
    yield* game.delay(2000)
  }
})
