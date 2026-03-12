import type { ItemUnit } from "diablo:game"
import { ItemAction, ItemCategory } from "./types.js"
import { classifyItem } from "./classify.js"
import type { ItemEvaluator } from "./evaluator.js"

export class SimpleEvaluator implements ItemEvaluator {
  shouldPickup(item: ItemUnit): boolean {
    const cat = classifyItem(item)
    // Always pick up runes, gems, jewels, charms, keys
    if (cat === ItemCategory.Rune || cat === ItemCategory.Gem ||
        cat === ItemCategory.Jewel || cat === ItemCategory.Charm ||
        cat === ItemCategory.Key) return true
    // Pick up scrolls/tomes/quest
    if (cat === ItemCategory.Tome || cat === ItemCategory.Quest) return true
    // Gold
    if (cat === ItemCategory.Gold) return true
    // Skip potions/scrolls on ground (belt managed by supplies)
    if (cat === ItemCategory.Potion || cat === ItemCategory.Scroll) return false
    // Equipment: pick up rare+ (quality 6=rare, 7=unique, 5=set)
    if (cat === ItemCategory.Equipment) return item.quality >= 5
    return false
  }

  evaluate(item: ItemUnit): ItemAction {
    // Unidentified magic+ needs ID first
    if (!item.identified && item.quality >= 4) return ItemAction.Identify

    const cat = classifyItem(item)
    // Always keep valuables
    if (cat === ItemCategory.Rune || cat === ItemCategory.Gem ||
        cat === ItemCategory.Jewel || cat === ItemCategory.Charm ||
        cat === ItemCategory.Key || cat === ItemCategory.Tome ||
        cat === ItemCategory.Quest) return ItemAction.Keep
    // Consumables: keep
    if (cat === ItemCategory.Potion || cat === ItemCategory.Scroll) return ItemAction.Keep
    // Gold: keep
    if (cat === ItemCategory.Gold) return ItemAction.Keep
    // Equipment: keep rare+, sell the rest
    if (cat === ItemCategory.Equipment) return item.quality >= 6 ? ItemAction.Keep : ItemAction.Sell
    return ItemAction.Ignore
  }
}
