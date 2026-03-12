import { createScript, Area, type Game, type Monster } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

const STAR = { x: 7792, y: 5292 }
const DIABLO_CLASSID = 243

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

  // Clear around star first
  yield* atk.clear({ killRange: 30 })
  yield* loot.lootGround()

  // Open seals and kill bosses in order
  for (const [name, group] of Object.entries(SEALS)) {
    game.log(`[chaos] === ${name} ===`)

    for (const sealId of group.seals) {
      yield* openSeal(game, move, atk, sealId, group.dx, group.dy)
    }

    yield* killSealBoss(game, move, atk, loot, name)
    yield* move.moveTo(STAR.x, STAR.y)
  }

  // All seals done — wait for Diablo at the star
  game.log('[chaos] waiting for Diablo')
  yield* move.moveTo(STAR.x, STAR.y)

  const spawned: unknown = yield* game.waitUntil(() => {
    return !!game.monsters.find((m: Monster) => m.classid === DIABLO_CLASSID && atk.alive(m))
  }, 500)

  if (spawned) {
    const diablo = game.monsters.find((m: Monster) => m.classid === DIABLO_CLASSID && atk.alive(m))
    if (diablo) {
      game.log('[chaos] Diablo spawned')
      yield* atk.kill(diablo)
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
    // Clear monsters near the seal before trying to open it
    yield* move.moveTo(preset.x + dx, preset.y + dy)
    yield* atk.clear({ killRange: 15, maxCasts: 20 })

    const seal = game.objects.find((o: any) => o.classid === sealClassid)
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

    const check = game.objects.find((o: any) => o.classid === sealClassid)
    if (check && check.mode !== 0) {
      game.log(`[chaos] seal ${sealClassid} opened`)
      return
    }

    yield* move.moveTo(preset.x - dx, preset.y - dy)
    for (let i = 0; i < 5; i++) yield
  }
  game.log(`[chaos] seal ${sealClassid} failed to open`)
}

function* killSealBoss(game: Game, move: any, atk: any, loot: any, name: string) {
  game.log(`[chaos] waiting for ${name} boss`)

  const found: unknown = yield* game.waitUntil(() => {
    return !!game.monsters.find((m: Monster) => atk.alive(m) && m.isSuperUnique)
  }, 100)

  if (!found) {
    game.log(`[chaos] ${name} boss not found`)
    return
  }

  const boss = game.monsters.find((m: Monster) => atk.alive(m) && m.isSuperUnique)
  if (!boss) return

  game.log(`[chaos] ${name} boss: cls=${boss.classid} name=${boss.name} at ${boss.x},${boss.y}`)
  yield* move.moveNear(boss.x, boss.y, 15)

  // Clear nearby monsters first, then focus the boss
  yield* atk.clear({ killRange: 20, maxCasts: 30 })
  yield* atk.kill(boss)

  game.log(`[chaos] ${name} boss dead`)
  yield* loot.lootGround()
}
