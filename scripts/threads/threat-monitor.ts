import { createScript, ItemContainer } from "diablo:game"
import { getBaseStat } from "../lib/txt.js"
import { assessBattlefield, formatBattlefield, formatThreat, type PotionInfo } from "../lib/monster-threat.js"
import { HP_POT_SET, RV_POT_SET } from "../lib/item-data.js"

const ASSESS_INTERVAL = 25 // every 25 frames (~1s)
const LOG_INTERVAL = 75    // full log every 75 frames (~3s)

function isTown(area: number): boolean {
  return area === 1 || area === 40 || area === 75 || area === 103 || area === 109
}

// One-time skill dump per classid
const dumpedClassids = new Set<number>()

function dumpMonsterSkills(game: any, classid: number, name: string) {
  if (dumpedClassids.has(classid)) return
  dumpedClassids.add(classid)

  const skills: string[] = []
  for (let i = 1; i <= 8; i++) {
    const skillId = getBaseStat("monstats", classid, `Skill${i}`)
    const skillLvl = getBaseStat("monstats", classid, `Sk${i}lvl`)
    const skillMode = getBaseStat("monstats", classid, `Sk${i}mode`)
    if (skillId > 0) {
      skills.push(`S${i}:id=${skillId} lvl=${skillLvl} mode=${skillMode}`)
    }
  }

  const a1min = getBaseStat("monstats", classid, "A1MinD")
  const a1max = getBaseStat("monstats", classid, "A1MaxD")
  const a2min = getBaseStat("monstats", classid, "A2MinD")
  const a2max = getBaseStat("monstats", classid, "A2MaxD")
  const isMelee = getBaseStat("monstats", classid, "isMelee")

  game.logVerbose(`[skills] ${name} (${classid}) melee=${isMelee} A1=${a1min}-${a1max} A2=${a2min}-${a2max}`)
  if (skills.length > 0) {
    game.logVerbose(`[skills]   ${skills.join(", ")}`)
  } else {
    game.logVerbose(`[skills]   (no skills)`)
  }
}

function getBeltPots(game: any): PotionInfo {
  const beltPots: string[] = []
  for (const item of game.items) {
    if (item.location === ItemContainer.Belt) {
      if (HP_POT_SET.has(item.code) || RV_POT_SET.has(item.code)) {
        beltPots.push(item.code)
      }
    }
  }
  return { beltPots }
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

    // Dump skills for each new monster type
    for (const mon of monsters) {
      dumpMonsterSkills(game, mon.classid, mon.name ?? `unknown`)
    }

    const potions = getBeltPots(game)
    const bf = assessBattlefield(monsters, potions)

    // Skip logging if nothing interesting
    if (bf.activeThreats === 0) continue

    // Brief status → main log
    const ttd = bf.timeToDeathSec === Infinity ? '∞' : bf.timeToDeathSec.toFixed(1) + 's'
    const sustain = bf.canSustain ? 'sustain' : `TTD=${ttd}`
    game.log(`[threat] ${bf.situationDanger.toUpperCase()} → ${bf.action} | ${bf.activeThreats} nearby ${bf.totalIncomingDps | 0}dps ${sustain} pots=${bf.potCharges} fightDmg=${bf.totalFightDamage | 0}`)

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
