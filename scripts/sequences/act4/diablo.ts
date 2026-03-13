import { createScript, Area, type Game, type Monster } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"

const STAR = { x: 7792, y: 5292 }
const DIABLO_CLASSID = 243

// Seal preset classids in Chaos Sanctuary (type 2 objects)
const SEALS = {
  vizier:   { seals: [395, 396], dx: 2, dy: 0 },
  deseis:   { seals: [394],      dx: 0, dy: 0 },
  infector: { seals: [393, 392], dx: 2, dy: 0 },
}

/**
 * Diablo — full Chaos Sanctuary clear.
 * Open all 3 seal groups, kill seal bosses, then fight Diablo at the star.
 *
 * This is a re-export of the existing chaos.ts sequence but placed here
 * for organizational consistency with the act structure.
 */
export const Diablo = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[diablo] starting run')
  yield* move.journeyTo(Area.RiverofFlame)
  yield* move.moveTo(STAR.x, STAR.y)

  // Clear around star first
  yield* atk.clear({ killRange: 30 })
  yield* loot.lootGround()

  // Open seals and kill bosses in order
  for (const [name, group] of Object.entries(SEALS)) {
    game.log(`[diablo] === ${name} ===`)

    for (const sealId of group.seals) {
      yield* openSeal(game, move, atk, sealId, group.dx, group.dy)
    }

    yield* killSealBoss(game, move, atk, loot, name)
    yield* move.moveTo(STAR.x, STAR.y)
  }

  // All seals done — wait for Diablo at the star
  game.log('[diablo] waiting for Diablo')
  yield* move.moveTo(STAR.x, STAR.y)

  const spawned: unknown = yield* game.waitUntil(() => {
    return !!game.monsters.find((m: Monster) => m.classid === DIABLO_CLASSID && atk.alive(m))
  }, 500)

  if (spawned) {
    const diablo = game.monsters.find((m: Monster) => m.classid === DIABLO_CLASSID && atk.alive(m))
    if (diablo) {
      game.log('[diablo] Diablo spawned — engaging')

      // Kite in a circle around the star at ~42 unit radius
      for (let casts = 0; casts < 100; casts++) {
        const d = game.monsters.find((m: Monster) => m.classid === DIABLO_CLASSID && atk.alive(m))
        if (!d) break

        // If Diablo is too close, teleport to opposite side of star
        if (d.distance < 10) {
          const angle = Math.atan2(d.y - STAR.y, d.x - STAR.x) + Math.PI
          const nx = Math.round(STAR.x + 42 * Math.cos(angle))
          const ny = Math.round(STAR.y + 42 * Math.sin(angle))
          yield* move.teleportTo(nx, ny)
        }

        yield* atk.kill(d, { maxCasts: 5 })
      }

      yield* loot.lootGround()
    }
  } else {
    game.log('[diablo] Diablo did not spawn')
  }

  game.log('[diablo] run complete')
})

function* openSeal(game: Game, move: any, atk: any, sealClassid: number, dx: number, dy: number) {
  const preset = game.findPreset(2, sealClassid)
  if (!preset) {
    game.log(`[diablo] seal ${sealClassid} not found`)
    return
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    yield* move.moveTo(preset.x + dx, preset.y + dy)
    yield* atk.clear({ killRange: 15, maxCasts: 20 })

    const seal = game.objects.find((o: any) => o.classid === sealClassid)
    if (!seal) {
      for (let i = 0; i < 5; i++) yield
      continue
    }

    if (seal.mode !== 0) {
      game.log(`[diablo] seal ${sealClassid} already open`)
      return
    }

    game.log(`[diablo] opening seal ${sealClassid} (attempt ${attempt + 1})`)
    game.interact(seal)
    for (let i = 0; i < 10; i++) yield

    const check = game.objects.find((o: any) => o.classid === sealClassid)
    if (check && check.mode !== 0) {
      game.log(`[diablo] seal ${sealClassid} opened`)
      return
    }

    yield* move.moveTo(preset.x - dx, preset.y - dy)
    for (let i = 0; i < 5; i++) yield
  }
  game.log(`[diablo] seal ${sealClassid} failed to open`)
}

function* killSealBoss(game: Game, move: any, atk: any, loot: any, name: string) {
  game.log(`[diablo] waiting for ${name} boss`)

  const found: unknown = yield* game.waitUntil(() => {
    return !!game.monsters.find((m: Monster) => atk.alive(m) && m.isSuperUnique)
  }, 100)

  if (!found) {
    game.log(`[diablo] ${name} boss not found`)
    return
  }

  const boss = game.monsters.find((m: Monster) => atk.alive(m) && m.isSuperUnique)
  if (!boss) return

  game.log(`[diablo] ${name} boss: cls=${boss.classid} at ${boss.x},${boss.y}`)
  yield* move.moveNear(boss.x, boss.y, 15)
  yield* atk.clear({ killRange: 20, maxCasts: 30 })
  yield* atk.kill(boss)

  game.log(`[diablo] ${name} boss dead`)
  yield* loot.lootGround()
}
