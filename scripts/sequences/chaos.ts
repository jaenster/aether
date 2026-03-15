import { createScript, Area, type Game, type Monster } from "diablo:game"
import type { Pos } from "../lib/attack-types.js"
import { findSpawnableLocation, CollisionMask } from "../lib/collision.js"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"
import { Buffs } from "../services/buffs.js"
import { Supplies } from "../services/supplies.js"
import { getLocaleString } from "diablo:native"

const STAR = { x: 7791, y: 5293 }
const DIABLO_CLASSID = 243

// Boss spawn deltas from the boss-triggering seal's position (from Ghidra: GlowCreate functions)
// Server flow: sealPos + delta → FindSpawnableLocation(radius=3, mask=0x3f11) → boss spawns there
const BOSS_DELTA: Record<number, { dx: number, dy: number }> = {
  392: { dx: -12, dy: -52 },  // Infector of Souls (seal 392)
  394: { dx: -39, dy: +33 },  // Lord De Seis (seal 394)
  396: { dx: +32, dy: +16 },  // Grand Vizier of Chaos (seal 396)
}

// Boss locale string IDs (language-independent)
const BOSS_LOCALE: Record<string, number> = {
  vizier:   2851,  // "Grand Vizier of Chaos"
  deseis:   2852,  // "Lord De Seis"
  infector: 2853,  // "Infector of Souls"
}

// Seal classids (392–396). All 5 must be activated AND all 3 bosses killed for Diablo to spawn.
// The LAST seal in each group is the boss-spawning seal (has the delta).
const SEALS = {
  vizier:   { seals: [395, 396], bossSeal: 396, dx: 2, dy: 0 },
  deseis:   { seals: [394],      bossSeal: 394, dx: 0, dy: 0 },
  infector: { seals: [392, 393], bossSeal: 392, dx: 2, dy: 0 },
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
 * Predict exactly where a seal boss will spawn.
 * Replicates server logic: sealPos + delta → FindSpawnableLocation spiral scan.
 */
function predictBossSpawn(game: Game, bossSealClassid: number): Pos | undefined {
  const delta = BOSS_DELTA[bossSealClassid]
  if (!delta) return undefined

  const preset = game.findPreset(2, bossSealClassid)
  if (!preset) return undefined

  const rawX = preset.x + delta.dx
  const rawY = preset.y + delta.dy

  return findSpawnableLocation(game, rawX, rawY, 3, CollisionMask.SPAWN) ?? { x: rawX, y: rawY }
}

export const Chaos = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const buffs = svc.get(Buffs)
  const supplies = svc.get(Supplies)

  yield* supplies.checkAndResupply()

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

  // Predict boss spawn positions from seal presets + deltas (before opening seals)
  const bossSpawns: Record<string, Pos> = {}
  for (const [name, group] of Object.entries(SEALS)) {
    const spawn = predictBossSpawn(game, group.bossSeal)
    if (spawn) {
      bossSpawns[name] = spawn
      game.log(`[chaos] predicted ${name} spawn: ${spawn.x},${spawn.y}`)
    }
  }

  // Open seals and kill bosses
  for (const [name, group] of Object.entries(SEALS)) {
    game.log(`[chaos] === ${name} ===`)

    for (const sealId of group.seals) {
      yield* openSeal(game, move, atk, sealId, group.dx, group.dy)
    }

    const bossPos = bossSpawns[name]
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
