import { createScript } from "diablo:game"
import { assessBattlefield, formatBattlefield, formatThreat } from "../lib/monster-threat.js"

const ASSESS_INTERVAL = 25 // every 25 frames (~1s)
const LOG_INTERVAL = 75    // full log every 75 frames (~3s)

function isTown(area: number): boolean {
  return area === 1 || area === 40 || area === 75 || area === 103 || area === 109
}

export const ThreatMonitor = createScript(function*(game, _svc) {
  let frameTick = 0

  while (true) {
    yield

    const area = game.player.area
    if (area <= 0 || isTown(area) || !game.inGame || game.player.hp <= 0) {
      frameTick = 0
      continue
    }

    frameTick++
    if (frameTick % ASSESS_INTERVAL !== 0) continue

    const monsters = [...game.monsters]
    if (monsters.length === 0) continue

    const bf = assessBattlefield(monsters)

    // Skip logging if nothing interesting
    if (bf.activeThreats === 0) continue

    // Brief status → main log
    const ttd = bf.timeToDeathSec === Infinity ? '∞' : bf.timeToDeathSec.toFixed(1) + 's'
    game.log(`[threat] ${bf.situationDanger.toUpperCase()} → ${bf.action} | ${bf.activeThreats} threats ${bf.totalIncomingDps | 0} dps TTD=${ttd} fightDmg=${bf.totalFightDamage | 0} melee=${bf.meleePackCount}`)

    // Individual threats → verbose log only
    for (const p of bf.threats) {
      if (p.threat.threat === "trivial") break
      game.logVerbose(`  ${formatThreat(p.mon, p.threat)}`)
    }

    // Full battlefield report → verbose log only, less frequently
    if (frameTick % LOG_INTERVAL === 0) {
      game.logVerbose(formatBattlefield(bf))
    }
  }
})
