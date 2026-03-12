import { createScript, Area, type Game, type Monster } from "diablo:game"
import type { Pos } from "../lib/attack-types.js"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"
import { Buffs } from "../services/buffs.js"
import { Supplies } from "../services/supplies.js"
import { getLocaleString } from "diablo:native"

const STAR = { x: 7791, y: 5293 }
const DIABLO_CLASSID = 243

// Layout detection: each seal wing has 2 possible tile layouts.
// Check the "active" seal preset position against a known coordinate to determine which.
// Values from kolbot: Vizier check y=5275, De Seis check x=7773, Infector check x=7893
function getLayout(game: Game, sealClassid: number, checkValue: number): 1 | 2 {
  const preset = game.findPreset(2, sealClassid)
  if (!preset) return 1
  // findPreset already returns world coords (room*5 + offset)
  // For vizier we check Y, for deseis/infector we check X
  if (sealClassid === 396) return preset.y === checkValue ? 1 : 2
  return preset.x === checkValue ? 1 : 2
}

// Boss spawn positions per layout (from kolbot)
const BOSS_POS: Record<string, Record<1|2, Pos>> = {
  vizier:   { 1: { x: 7691, y: 5292 }, 2: { x: 7695, y: 5316 } },
  deseis:   { 1: { x: 7771, y: 5196 }, 2: { x: 7798, y: 5186 } },
  infector: { 1: { x: 7919, y: 5290 }, 2: { x: 7928, y: 5295 } },
}

// Boss locale string IDs (language-independent)
const BOSS_LOCALE: Record<string, number> = {
  vizier:   2851,  // "Grand Vizier of Chaos"
  deseis:   2852,  // "Lord De Seis"
  infector: 2853,  // "Infector of Souls"
}

// Seal classids (392–396). All 5 must be activated AND all 3 bosses killed for Diablo to spawn.
// Seal order from kolbot: vizier 395→396, deseis 394, infector 392→393
const SEALS = {
  vizier:   { seals: [395, 396], layoutSeal: 396, layoutCheck: 5275, dx: 2, dy: 0 },
  deseis:   { seals: [394],      layoutSeal: 394, layoutCheck: 7773, dx: 0, dy: 0 },
  infector: { seals: [392, 393], layoutSeal: 392, layoutCheck: 7893, dx: 2, dy: 0 },
}

const ALL_SEAL_IDS = [392, 393, 394, 395, 396]

// Seal boss classids for pre-attack damage estimation
const BOSS_CLASSID: Record<string, number> = {
  vizier:   702,   // Grand Vizier of Chaos
  deseis:   740,   // Lord De Seis
  infector: 741,   // Infector of Souls
}

// Frames between last seal activation and boss spawn (~8 frames observed)
const SEAL_SPAWN_DELAY = 8

export const Chaos = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const buffs = svc.get(Buffs)
  const supplies = svc.get(Supplies)

  yield* supplies.checkAndResupply()

  game.log('[chaos] starting run')
  yield* move.journeyTo(Area.RiverofFlame)
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

    const bossPos = BOSS_POS[name]![layouts[name]!]!
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
  }, 750)

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
    yield* atk.clear({ killRange: 20, maxCasts: 20 })

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
    yield* atk.clear({ killRange: 10, maxCasts: 10 })

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
