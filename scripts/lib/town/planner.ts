import type { TownAction, TownContext } from "./action.js"
import type { TownTask } from "./task.js"
import type { NpcEntry } from "./npc-flags.js"
import { Urgency } from "./enums.js"
import { NpcFlags, actFromArea, getGroups } from "./npc-flags.js"
import { distToNpc } from "./act-data.js"

interface RouteNode {
  entry: NpcEntry | null  // null for stash
  classid: number
  tasks: TownTask[]
}

export class TownPlan {
  private tasks: TownTask[] = []
  private route: RouteNode[] = []
  private _urgency: Urgency = Urgency.Not

  constructor(
    private actions: TownAction[],
    private ctx: TownContext,
  ) {}

  get urgency(): Urgency { return this._urgency }

  calculate(): void {
    // 1. Assess urgency for each action
    this.tasks = []
    for (const action of this.actions) {
      const urgency = action.check(this.ctx)
      if (urgency > Urgency.Not) {
        this.tasks.push({ action, urgency })
      }
    }

    if (this.tasks.length === 0) {
      this._urgency = Urgency.Not
      return
    }

    this._urgency = Math.max(...this.tasks.map(t => t.urgency)) as Urgency

    const act = actFromArea(this.ctx.game.area)

    // 2. Separate stash tasks (self-navigating) from NPC tasks
    const stashTasks = this.tasks.filter(t => t.action.npcFlag === NpcFlags.STASH)
    const npcTasks = this.tasks.filter(t => t.action.npcFlag !== NpcFlags.STASH)

    // 3. Collect NPC flags — needed tasks first, then convenience as fallback
    let neededFlags: number = NpcFlags.NONE
    let convenienceFlags: number = NpcFlags.NONE
    for (const task of npcTasks) {
      if (task.urgency >= Urgency.Needed) {
        neededFlags |= task.action.npcFlag
      } else {
        convenienceFlags |= task.action.npcFlag
      }
    }

    // 4. Find minimum NPC cover — use needed flags, or convenience if no needed
    const coverFlags = neededFlags !== NpcFlags.NONE ? neededFlags : convenienceFlags
    const groups = coverFlags !== NpcFlags.NONE ? getGroups(act, coverFlags as NpcFlags) : []

    // Pick the best cover (shortest total distance)
    let bestCover: NpcEntry[] = []
    if (groups.length > 0) {
      bestCover = groups[0]!
      let bestDist = Infinity
      for (const group of groups) {
        let totalDist = 0
        for (const npc of group) {
          totalDist += distToNpc(this.ctx.game, npc.classid)
        }
        if (totalDist < bestDist) {
          bestDist = totalDist
          bestCover = group
        }
      }
    }

    // 5. Assign tasks to NPCs in the cover
    const nodeMap = new Map<number, RouteNode>()
    for (const npc of bestCover) {
      nodeMap.set(npc.classid, { entry: npc, classid: npc.classid, tasks: [] })
    }

    // Assign needed tasks first
    for (const task of npcTasks) {
      if (task.urgency < Urgency.Needed) continue
      const assignedNpc = bestCover.find(n => (n.flags & task.action.npcFlag) !== 0)
      if (assignedNpc) {
        task.npc = assignedNpc
        nodeMap.get(assignedNpc.classid)!.tasks.push(task)
      }
    }

    // 6. Attach convenience tasks — piggyback onto existing visits, or use their own cover
    for (const task of npcTasks) {
      if (task.urgency >= Urgency.Needed) continue
      const targetNpc = bestCover.find(n => (n.flags & task.action.npcFlag) !== 0)
      if (targetNpc) {
        task.npc = targetNpc
        nodeMap.get(targetNpc.classid)!.tasks.push(task)
      }
    }

    // 7. Sort route nodes by distance, then enforce cross-node dependency order
    const nodes = [...nodeMap.values()].filter(n => n.tasks.length > 0)
    this.route = enforceDependencyOrder(sortByDistance(nodes, this.ctx))

    // 8. Sort tasks within each node respecting dependencies
    for (const node of this.route) {
      node.tasks = topoSort(node.tasks, this.tasks)
    }

    // 9. Append stash as a separate stop if needed
    if (stashTasks.length > 0) {
      // Check dependencies — stash depends on identify and sell
      this.route.push({
        entry: null,
        classid: -1,
        tasks: stashTasks,
      })
    }
  }

  summary(): string {
    if (this.route.length === 0) return 'nothing needed'
    return this.route.map(n => {
      const name = n.entry?.name ?? 'Stash'
      const taskNames = n.tasks.map(t => t.action.type).join(', ')
      return `${name} (${taskNames})`
    }).join(' → ')
  }

  *execute(ctx: TownContext) {
    for (const node of this.route) {
      let npc: any = null

      // Walk to the NPC or stash
      if (node.classid === -1) {
        // Stash — handled by the stash action's run()
      } else {
        npc = ctx.game.npcs.find(n => n.classid === node.classid)
        if (!npc) {
          ctx.game.log(`[town:plan] NPC classid=${node.classid} not found, skipping`)
          continue
        }
        yield* ctx.move.walkTo(npc.x, npc.y)
      }

      // Split tasks: non-trade first, then trade tasks in a single session
      const nonTrade = node.tasks.filter(t => !t.action.needsTrade)
      const trade = node.tasks.filter(t => t.action.needsTrade)

      // Run non-trade tasks (heal, repair, identify, resurrect)
      for (const task of nonTrade) {
        ctx.game.log(`[town:plan] ${task.action.type} at ${node.entry?.name ?? 'Stash'}`)
        yield* task.action.run(ctx, node.classid)
      }

      // Run trade tasks in a single open/close session
      if (trade.length > 0 && npc) {
        const ok = yield* npc.openTrade()
        if (ok) {
          yield* ctx.game.delay(300)
          for (const task of trade) {
            ctx.game.log(`[town:plan] ${task.action.type} at ${node.entry?.name ?? 'Stash'}`)
            yield* task.action.run(ctx, node.classid)
          }
          yield* npc.close()
        } else {
          ctx.game.log(`[town:plan] trade failed at ${node.entry?.name}`)
          yield* npc.close()
        }
      }
    }
  }

  *executeIf(ctx: TownContext, minUrgency: Urgency) {
    if (this._urgency >= minUrgency) {
      yield* this.execute(ctx)
    }
  }
}

/** Sort route nodes by nearest-neighbor from current position */
function sortByDistance(nodes: RouteNode[], ctx: TownContext): RouteNode[] {
  if (nodes.length <= 1) return nodes

  const result: RouteNode[] = []
  const remaining = [...nodes]

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = distToNpc(ctx.game, remaining[i]!.classid)
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    result.push(remaining.splice(bestIdx, 1)[0]!)
  }

  return result
}

/**
 * Ensure cross-node dependency ordering.
 * If node A contains a task that depends on a task in node B, node B must come first.
 */
function enforceDependencyOrder(nodes: RouteNode[]): RouteNode[] {
  if (nodes.length <= 1) return nodes

  const sorted = [...nodes]
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < sorted.length; i++) {
      for (const task of sorted[i]!.tasks) {
        for (const dep of (task.action.dependencies ?? [])) {
          const depIdx = sorted.findIndex(n => n.tasks.some(t => t.action.type === dep))
          if (depIdx > i) {
            // Dependency is after us — swap
            const tmp = sorted[i]!
            sorted[i] = sorted[depIdx]!
            sorted[depIdx] = tmp
            changed = true
          }
        }
      }
    }
  }
  return sorted
}

/**
 * Topological sort tasks within a node, respecting dependencies.
 * Tasks in other nodes are pre-marked as completed since they run in earlier route stops.
 */
function topoSort(nodeTasks: TownTask[], allTasks: TownTask[]): TownTask[] {
  if (nodeTasks.length <= 1) return nodeTasks

  const completed = new Set<string>()
  const result: TownTask[] = []
  const remaining = [...nodeTasks]
  const nodeTaskTypes = new Set(nodeTasks.map(t => t.action.type))
  const allTaskTypes = new Set(allTasks.map(t => t.action.type))

  // Tasks in other nodes have already run by the time we reach this node
  for (const t of allTasks) {
    if (!nodeTaskTypes.has(t.action.type)) completed.add(t.action.type)
  }

  let maxIter = remaining.length * remaining.length + 1
  while (remaining.length > 0 && maxIter-- > 0) {
    const ready = remaining.findIndex(t => {
      const deps = t.action.dependencies ?? []
      // A dependency is satisfied if it completed OR was never planned (urgency=Not)
      return deps.every(d => completed.has(d) || !allTaskTypes.has(d))
    })

    if (ready === -1) {
      // Unresolvable deps — append remaining in original order
      result.push(...remaining)
      break
    }

    const task = remaining.splice(ready, 1)[0]!
    completed.add(task.action.type)
    result.push(task)
  }

  return result
}
