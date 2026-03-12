import { createScript, Area } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

const STAR = { x: 7792, y: 5292 }
const DIABLO_CLASSID = 243

function isAlive(m: any): boolean {
  return m.hp > 0 && m.mode !== 0 && m.mode !== 12
}

// Seal preset classids in Chaos Sanctuary (type 2 objects)
// Each group: [seals to open], the last one is the "active" seal that spawns the boss
const SEALS = {
  vizier:   { seals: [395, 396], dx: 2, dy: 0 },
  deseis:   { seals: [394],      dx: 0, dy: 0 },
  infector: { seals: [393, 392], dx: 2, dy: 0 },
}

export const Chaos = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[chaos] starting run')
  // RoF → CS is seamless (no exit tile), so WP to RoF and tele straight to the star
  yield* move.journeyTo(Area.RiverofFlame)
  yield* move.moveTo(STAR.x, STAR.y)

  // Open seals and kill bosses in order
  for (const [name, group] of Object.entries(SEALS)) {
    game.log(`[chaos] === ${name} ===`)

    // Open all seals in this group
    for (const sealId of group.seals) {
      yield* openSeal(game, move, sealId, group.dx, group.dy)
    }

    // After opening the last (active) seal, a boss spawns
    // Wait for a super unique to appear, then kill it
    yield* killSealBoss(game, move, atk, loot, name)

    // Return to star between groups
    yield* move.moveTo(STAR.x, STAR.y)
  }

  // All seals done — wait for Diablo at the star
  game.log('[chaos] waiting for Diablo')
  yield* move.moveTo(STAR.x, STAR.y)

  const spawned: unknown = yield* game.waitUntil(() => {
    return !!game.monsters.find(m => m.classid === DIABLO_CLASSID && isAlive(m))
  }, 500) // ~20 seconds

  if (spawned) {
    game.log('[chaos] Diablo spawned')
    yield* atk.kill(DIABLO_CLASSID)
    yield* loot.lootGround()
  } else {
    game.log('[chaos] Diablo did not spawn')
  }

  game.log('[chaos] run complete')
})

function* openSeal(game: any, move: any, sealClassid: number, dx: number, dy: number) {
  const preset = game.findPreset(2, sealClassid)
  if (!preset) {
    game.log(`[chaos] seal ${sealClassid} not found`)
    return
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    yield* move.moveTo(preset.x + dx, preset.y + dy)

    const seal = game.objects.find(o => o.classid === sealClassid)
    if (!seal) {
      for (let i = 0; i < 5; i++) yield
      continue
    }

    if (seal.mode !== 0) {
      game.log(`[chaos] seal ${sealClassid} already open`)
      return
    }

    game.log(`[chaos] opening seal ${sealClassid} (attempt ${attempt + 1})`)
    game.interact(seal)
    for (let i = 0; i < 10; i++) yield

    // Re-check
    const check = game.objects.find(o => o.classid === sealClassid)
    if (check && check.mode !== 0) {
      game.log(`[chaos] seal ${sealClassid} opened`)
      return
    }

    // Reposition for retry
    yield* move.moveTo(preset.x - dx, preset.y - dy)
    for (let i = 0; i < 5; i++) yield
  }
  game.log(`[chaos] seal ${sealClassid} failed to open`)
}

function* killSealBoss(game: any, move: any, atk: any, loot: any, name: string) {
  // Wait for a super unique monster to appear (the seal boss)
  game.log(`[chaos] waiting for ${name} boss`)

  const found: unknown = yield* game.waitUntil(() => {
    return !!game.monsters.find(m => isAlive(m) && m.isSuperUnique)
  }, 100) // ~4 seconds

  if (!found) {
    game.log(`[chaos] ${name} boss not found`)
    return
  }

  const boss = game.monsters.find(m => isAlive(m) && m.isSuperUnique)
  if (boss) {
    game.log(`[chaos] ${name} boss: cls=${boss.classid} at ${boss.x},${boss.y}`)
    yield* move.moveNear(boss.x, boss.y, 15)
    yield* atk.kill(boss.classid)
    game.log(`[chaos] ${name} boss dead`)
    yield* loot.lootGround()
  }
}
