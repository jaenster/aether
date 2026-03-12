import { createService, type Game, type ItemUnit } from "diablo:game"
import { ItemAction } from "./types.js"
import { SimpleEvaluator } from "./simple-evaluator.js"

export interface ItemEvaluator {
  shouldPickup(item: ItemUnit): boolean
  evaluate(item: ItemUnit): ItemAction
}

export const ItemGrading = createService((_game: Game): ItemEvaluator => {
  return new SimpleEvaluator()
})
