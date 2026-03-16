import type { Monster } from "diablo:game"
import { isAttackable, isShaman, isFallen, isSpecial } from "./unit-extensions.js"

export interface PackInfo {
  /** Center of the pack (population centroid) */
  cx: number
  cy: number
  /** Monsters in this pack */
  members: Monster[]
  /** Total threat score */
  threat: number
  /** Does this pack contain a shaman? */
  hasShaman: boolean
}

/** Detect monster packs within a radius of a starting position.
 *  Clusters attackable monsters within `radius` tiles of each other,
 *  then re-centers on the population centroid. */
export function detectPacks(
  monsters: Iterable<Monster>,
  centerX: number,
  centerY: number,
  radius = 15,
  maxRange = 25,
): PackInfo[] {
  // Collect all attackable monsters within maxRange of center
  const nearby: Monster[] = []
  for (const m of monsters) {
    if (!isAttackable(m)) continue
    const dx = m.x - centerX
    const dy = m.y - centerY
    if (dx * dx + dy * dy > maxRange * maxRange) continue
    nearby.push(m)
  }

  if (nearby.length === 0) return []

  // Simple greedy clustering: pick densest unassigned monster, expand
  const assigned = new Set<number>()
  const packs: PackInfo[] = []

  // Sort by density (most neighbors first)
  const neighborCount = nearby.map((m, i) => {
    let count = 0
    for (let j = 0; j < nearby.length; j++) {
      if (i === j) continue
      const dx = m.x - nearby[j]!.x
      const dy = m.y - nearby[j]!.y
      if (dx * dx + dy * dy <= radius * radius) count++
    }
    return { m, i, count }
  })
  neighborCount.sort((a, b) => b.count - a.count)

  for (const { m: seed, i: seedIdx } of neighborCount) {
    if (assigned.has(seedIdx)) continue

    const members: Monster[] = [seed]
    assigned.add(seedIdx)

    // Expand: add all unassigned monsters within radius of seed
    for (let j = 0; j < nearby.length; j++) {
      if (assigned.has(j)) continue
      const dx = nearby[j]!.x - seed.x
      const dy = nearby[j]!.y - seed.y
      if (dx * dx + dy * dy <= radius * radius) {
        members.push(nearby[j]!)
        assigned.add(j)
      }
    }

    // Compute centroid
    let sumX = 0, sumY = 0
    let hasShaman = false
    for (const member of members) {
      sumX += member.x
      sumY += member.y
      if (isShaman(member)) hasShaman = true
    }
    const cx = Math.round(sumX / members.length)
    const cy = Math.round(sumY / members.length)

    // Score: specials worth more, shamans worth much more
    let threat = 0
    for (const member of members) {
      if (isShaman(member)) threat += 5
      else if (isSpecial(member)) threat += 3
      else if (isFallen(member) && hasShaman) threat += 0.5 // deprioritize fallens near shaman
      else threat += 1
    }

    packs.push({ cx, cy, members, threat, hasShaman })
  }

  // Sort packs by threat (highest first)
  packs.sort((a, b) => b.threat - a.threat)
  return packs
}

/** Find the single most important pack to attack. Shaman packs get 1.6x range bonus. */
export function findBestPack(
  monsters: Iterable<Monster>,
  playerX: number,
  playerY: number,
  killRange = 25,
): PackInfo | null {
  const packs = detectPacks(monsters, playerX, playerY, 15, killRange)
  if (packs.length === 0) return null

  // Score = threat / distance, with shaman range bonus
  let best: PackInfo | null = null
  let bestScore = -1

  for (const pack of packs) {
    const dx = pack.cx - playerX
    const dy = pack.cy - playerY
    const dist = Math.sqrt(dx * dx + dy * dy)
    const effectiveRange = pack.hasShaman ? killRange * 1.6 : killRange
    if (dist > effectiveRange) continue

    const score = pack.threat / Math.max(1, dist)
    if (score > bestScore) {
      bestScore = score
      best = pack
    }
  }

  return best
}
