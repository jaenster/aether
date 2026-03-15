import { ItemContainer } from "diablo:game"
import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import type { TownAction, TownContext } from "../action.js"
import { npcBuy } from "../../packets.js"

/** Find a tome by code anywhere the player has access to (inv > cube > stash) */
function findTome(ctx: TownContext, code: string) {
  return ctx.game.items.find(i => i.location === ItemContainer.Inventory && i.code === code)
    ?? ctx.game.items.find(i => i.location === ItemContainer.Cube && i.code === code)
    ?? ctx.game.items.find(i => i.location === ItemContainer.Stash && i.code === code)
    ?? null
}

function getTpTome(ctx: TownContext) { return findTome(ctx, 'tbk') }
function getIdTome(ctx: TownContext) { return findTome(ctx, 'ibk') }

export const scrollAction: TownAction = {
  type: 'scroll',
  npcFlag: NpcFlags.SCROLL,
  needsTrade: true,

  check(ctx: TownContext): Urgency {
    const tpTome = getTpTome(ctx)
    const idTome = getIdTome(ctx)
    if (!tpTome) return Urgency.Needed
    if (tpTome.quantity < 5) return Urgency.Needed

    if (!idTome) return Urgency.Needed
    if (idTome.quantity < 5) return Urgency.Needed

    if (tpTome.quantity < 15 || idTome.quantity < 15) return Urgency.Convenience
    return Urgency.Not
  },

  *run(ctx: TownContext, npcClassid: number) {
    const npc = ctx.game.npcs.find(n => n.classid === npcClassid)
    if (!npc) return false

    const shopItems = ctx.game.items.filter(i => i.location === ItemContainer.Vendor)

    // TP tome
    let tpTome = getTpTome(ctx)
    if (!tpTome) {
      const shopTome = shopItems.find(i => i.code === 'tbk')
      if (shopTome) {
        ctx.game.log(`[town:scroll] buying TP tome`)
        ctx.game.sendPacket(npcBuy(npc.unitId, shopTome.unitId, 0, 0))
        yield* ctx.game.delay(300)
        tpTome = getTpTome(ctx)
      }
    }

    if (tpTome && tpTome.quantity < 20) {
      const need = 20 - tpTome.quantity
      const scroll = shopItems.find(i => i.code === 'tsc')
      if (scroll) {
        ctx.game.log(`[town:scroll] buying ${need}x TP`)
        for (let i = 0; i < need; i++) {
          ctx.game.sendPacket(npcBuy(npc.unitId, scroll.unitId, 0, 0))
          yield* ctx.game.delay(150)
        }
      }
    }

    // ID tome
    let idTome = getIdTome(ctx)
    if (!idTome) {
      const shopIdTome = shopItems.find(i => i.code === 'ibk')
      if (shopIdTome) {
        ctx.game.log(`[town:scroll] buying ID tome`)
        ctx.game.sendPacket(npcBuy(npc.unitId, shopIdTome.unitId, 0, 0))
        yield* ctx.game.delay(300)
        idTome = getIdTome(ctx)
      }
    }

    if (idTome && idTome.quantity < 20) {
      const need = 20 - idTome.quantity
      const scroll = shopItems.find(i => i.code === 'isc')
      if (scroll) {
        ctx.game.log(`[town:scroll] buying ${need}x ID`)
        for (let i = 0; i < need; i++) {
          ctx.game.sendPacket(npcBuy(npc.unitId, scroll.unitId, 0, 0))
          yield* ctx.game.delay(150)
        }
      }
    }

    return true
  },
}
