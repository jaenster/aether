import { createScript, Area, type Game, type Monster } from "diablo:game"
import type { Pos } from "../lib/attack-types.js"
import { predictSpawnMonsterPosition } from "../lib/collision.js"
import type { D2Seed } from "../lib/seed.js"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"
import { Buffs } from "../services/buffs.js"
import { Supplies } from "../services/supplies.js"
import { getLocaleString } from "diablo:native"

const STAR = { x: 7791, y: 5293 }
const DIABLO_CLASSID = 243

// Static glow positions per layout (observed, deterministic from collision grid)
// The glow is where the boss spawn algorithm starts — FindSpawnableLocation runs FROM here
// to find the actual boss position (which can shift if players/monsters block tiles).
const GLOW_POS: Record<string, Record<1|2, Pos>> = {
  vizier:   { 1: { x: 7674, y: 5320 }, 2: { x: 7683, y: 5317 } }, // TODO: verify layout 2
  deseis:   { 1: { x: 7775, y: 5189 }, 2: { x: 7775, y: 5189 } }, // TODO: verify layout 2
  infector: { 1: { x: 7903, y: 5269 }, 2: { x: 7903, y: 5269 } }, // TODO: verify layout 2
}


// Layout detection: each seal wing has 2 possible tile layouts.
function getLayout(game: Game, sealClassid: number, checkValue: number): 1 | 2 {
  const preset = game.findPreset(2, sealClassid)
  if (!preset) return 1
  if (sealClassid === 396) return preset.y === checkValue ? 1 : 2
  return preset.x === checkValue ? 1 : 2
}

// Boss locale string IDs (language-independent)
const BOSS_LOCALE: Record<string, number> = {
  vizier:   2851,  // "Grand Vizier of Chaos"
  deseis:   2852,  // "Lord De Seis"
  infector: 2853,  // "Infector of Souls"
}

// Seal classids (392–396). All 5 must be activated AND all 3 bosses killed for Diablo to spawn.
const SEALS = {
  vizier:   { seals: [395, 396], layoutSeal: 396, layoutCheck: 5275, dx: 2, dy: 0 },
  deseis:   { seals: [394],      layoutSeal: 394, layoutCheck: 7773, dx: 0, dy: 0 },
  infector: { seals: [392, 393], layoutSeal: 392, layoutCheck: 7893, dx: 2, dy: 0 },
}

// Seal boss classids for pre-attack damage estimation
const BOSS_CLASSID: Record<string, number> = {
  vizier:   702,   // Grand Vizier of Chaos
  deseis:   740,   // Lord De Seis
  infector: 741,   // Infector of Souls
}

// Frames between last seal activation and boss spawn (~8 frames observed)
const SEAL_SPAWN_DELAY = 8

/**
 * Predict boss spawn position using the actual D2 SpawnMonster algorithm.
 * Reads room seed, replicates the perimeter walk with RNG to find exact tile.
 * Falls back to glow position if seed can't be read (room not loaded).
 */
function predictBossSpawn(game: Game, name: string, layout: 1 | 2): Pos | undefined {
  const glowPos = GLOW_POS[name]?.[layout]
  if (!glowPos) return undefined

  // Read room seed at glow position (same seed the server uses for SpawnMonster)
  const roomSeed = game.getRoomSeed(glowPos.x, glowPos.y)
  if (!roomSeed) {
    game.log(`[chaos] ${name}: room not loaded at glow, using glow pos`)
    return glowPos
  }

  // Copy seed (predictSpawnMonsterPosition mutates it)
  const seed: D2Seed = { low: roomSeed.low, high: roomSeed.high }

  // spawnCol for super uniques: typically 0 (default mask 0x3C01)
  const spawn = predictSpawnMonsterPosition(game, seed, glowPos.x, glowPos.y, 1, 0)
  if (spawn) {
    game.log(`[chaos] ${name}: glow=${glowPos.x},${glowPos.y} seed=${roomSeed.low}:${roomSeed.high} → spawn=${spawn.x},${spawn.y}`)
    return spawn
  }

  game.log(`[chaos] ${name}: no valid spawn found, using glow pos`)
  return glowPos
}

export const Chaos = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const buffs = svc.get(Buffs)
  const supplies = svc.get(Supplies)

  // yield* supplies.checkAndResupply()

  game.log('[chaos] starting run')
  yield* move.journeyTo(Area.RiverofFlame)

  // Buff up now that we're out of town
  yield* buffs.refreshAll()

  yield* move.moveTo(STAR.x, STAR.y)

  // Clear around star first
  yield* atk.clear({
    killRange: 30,
    priority: (a, b) => {
      if (a.isSuperUnique !== b.isSuperUnique) return a.isSuperUnique ? -1 : 1
      if (a.isUnique !== b.isUnique) return a.isUnique ? -1 : 1
      if (a.isChampion !== b.isChampion) return a.isChampion ? -1 : 1
      return a.distance - b.distance
    },
  })
  yield* loot.lootGround()

  // Detect layouts
  const layouts: Record<string, 1|2> = {}
  for (const [name, group] of Object.entries(SEALS)) {
    layouts[name] = getLayout(game, group.layoutSeal, group.layoutCheck)
  }
  game.log(`[chaos] layouts: vizier=${layouts.vizier} deseis=${layouts.deseis} infector=${layouts.infector}`)

  // Open seals and kill bosses
  for (const [name, group] of Object.entries(SEALS)) {
    game.log(`[chaos] === ${name} (layout ${layouts[name]}) ===`)

    for (const sealId of group.seals) {
      yield* openSeal(game, move, atk, sealId, group.dx, group.dy)
    }

    // Predict boss spawn from static glow position + runtime collision scan
    const bossPos = predictBossSpawn(game, name, layouts[name]!)
    if (!bossPos) {
      game.log(`[chaos] no predicted spawn for ${name}, skipping`)
      continue
    }
    yield* killSealBoss(game, move, atk, loot, name, bossPos)

    // Refresh buffs between wings if any expired
    if (buffs.needsRefresh()) {
      yield* buffs.refreshOne()
    }

    yield* move.moveTo(STAR.x, STAR.y)
  }

  // Wait for Diablo at star
  game.log('[chaos] waiting for Diablo')
  yield* move.moveTo(STAR.x, STAR.y)

  const spawned: unknown = yield* game.waitUntil(() => {
    return !!game.monsters.find((m: Monster) => m.classid === DIABLO_CLASSID && atk.alive(m))
  }, 1250)

  if (spawned) {
    const diablo = game.monsters.find((m: Monster) => m.classid === DIABLO_CLASSID && atk.alive(m))
    if (diablo) {
      game.log(`[chaos] Diablo spawned at ${diablo.x},${diablo.y}`)
      // Skip ground-targeted skills (Fire Wall=46, Blaze=52) — Diablo is stationary
      const noGroundSkills = (sk: number) => sk !== 46 && sk !== 52
      yield* atk.kill(diablo, { maxCasts: 200, skillFilter: noGroundSkills })
      game.log(`[chaos] Diablo ${atk.alive(diablo) ? 'SURVIVED' : 'dead'}`)
      yield* loot.lootGround()
    }
  } else {
    game.log('[chaos] Diablo did not spawn')
  }

  game.log('[chaos] run complete')
})

function* openSeal(game: Game, move: any, atk: any, sealClassid: number, dx: number, dy: number) {
  const preset = game.findPreset(2, sealClassid)
  if (!preset) {
    game.log(`[chaos] seal ${sealClassid} not found`)
    return
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    // Move to preset area first to load the seal
    yield* move.moveTo(preset.x + dx, preset.y + dy)
    // Minimal cleanup — just enough to not die while opening
    yield* atk.clear({ killRange: 10, maxCasts: 5 })

    const seal = game.objects.find((o: any) => o.classid === sealClassid)
    if (!seal) {
      for (let i = 0; i < 5; i++) yield
      continue
    }

    if (seal.mode !== 0) {
      game.log(`[chaos] seal ${sealClassid} already open`)
      return
    }

    // Teleport close to the actual seal object
    yield* move.moveNear(seal.x, seal.y, 5)
    yield* atk.clear({ killRange: 8, maxCasts: 5 })

    game.log(`[chaos] opening seal ${sealClassid} (attempt ${attempt + 1})`)
    game.interact(seal)
    for (let i = 0; i < 10; i++) yield

    const check = game.objects.find((o: any) => o.classid === sealClassid)
    if (check && check.mode !== 0) {
      game.log(`[chaos] seal ${sealClassid} opened`)
      return
    }

    // Nudge position on retry
    yield* move.moveTo(seal.x + dx * 2, seal.y + dy * 2)
    for (let i = 0; i < 5; i++) yield
  }
  game.log(`[chaos] seal ${sealClassid} failed to open`)
}

function* killSealBoss(game: Game, move: any, atk: any, loot: any, name: string, bossPos: Pos) {
  const localeId = BOSS_LOCALE[name]!
  const bossName = getLocaleString(localeId)

  game.log(`[chaos] waiting for ${bossName} near ${bossPos.x},${bossPos.y}`)

  // Pre-attack: cast delayed skill (Meteor, Blizzard, etc.) timed to land at spawn
  const bossClassId = BOSS_CLASSID[name]
  if (bossClassId) {
    yield* atk.preAttack({
      pos: bossPos,
      classId: bossClassId,
      framesUntilSpawn: SEAL_SPAWN_DELAY,
    })
  }

  yield* move.moveTo(bossPos.x, bossPos.y)

  const findBoss = () => game.monsters.find((m: Monster) =>
    atk.alive(m) && m.name === bossName
  )

  const found: unknown = yield* game.waitUntil(() => !!findBoss(), 200)

  // Log boss position on first few frames to see if it moves from glow
  if (found) {
    const b = findBoss()
    if (b) {
      for (let f = 0; f < 5; f++) {
        game.log(`[chaos] ${bossName} f${f}: ${b.x},${b.y} mode=${b.mode}`)
        yield
      }
    }
  }

  if (!found) {
    game.log(`[chaos] ${bossName} not found, searching...`)
    for (const [ox, oy] of [[40, 0], [-40, 0], [0, 40], [0, -40], [30, 30], [-30, -30]] as [number, number][]) {
      yield* move.moveTo(bossPos.x + ox, bossPos.y + oy)
      yield* atk.clear({ killRange: 25, maxCasts: 15 })
      if (findBoss()) {
        game.log(`[chaos] ${bossName} found during search`)
        break
      }
    }
  }

  const boss = findBoss()
  if (!boss) {
    game.log(`[chaos] ${bossName} not found after search`)
    return
  }

  game.log(`[chaos] found ${bossName} cls=${boss.classid} at ${boss.x},${boss.y}`)
  yield* move.moveNear(boss.x, boss.y, 15)

  // Kill boss first, then minions
  yield* atk.clear({
    killRange: 25,
    maxCasts: 40,
    priority: (a: Monster, b: Monster) => {
      if (a.name === bossName && b.name !== bossName) return -1
      if (b.name === bossName && a.name !== bossName) return 1
      if (a.isSuperUnique !== b.isSuperUnique) return a.isSuperUnique ? -1 : 1
      return a.distance - b.distance
    },
  })

  const bossAfter = findBoss()
  if (bossAfter) {
    game.log(`[chaos] ${bossName} still alive, focusing (hp=${bossAfter.hp})`)
    yield* atk.kill(bossAfter, { maxCasts: 100 })
  }

  game.log(`[chaos] ${bossName}: ${findBoss() ? 'FAILED' : 'dead'}`)
  yield* loot.lootGround()
}
