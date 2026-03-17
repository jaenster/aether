import { createService, type Game, type ItemUnit, ItemContainer } from "diablo:game"
import { itemToBuffer, bufferToStorage, Packet } from "../lib/packets.js"
import { txtReadFieldU } from "diablo:native"

/** 4x10 inventory grid tracking + item management.
 *  Absorbs Ryuk's Storage.CanFit/MoveTo and inventory sorting logic. */
export const Inventory = createService((game: Game, _svc) => {
  // 4 rows x 10 columns inventory grid
  const ROWS = 4
  const COLS = 10
  const grid: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false))

  /** Rebuild grid from current inventory items */
  function refreshGrid() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        grid[r]![c] = false
      }
    }

    for (const item of game.items) {
      if (item.location !== ItemContainer.Inventory) continue
      // Item position in inventory grid: stat 73 = x, stat 74 = y (0-based)
      const ix = item.getStat(73, 0)
      const iy = item.getStat(74, 0)
      // Item dimensions from txt
      const w = getItemWidth(item)
      const h = getItemHeight(item)

      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const gy = iy + dy
          const gx = ix + dx
          if (gy < ROWS && gx < COLS) {
            grid[gy]![gx] = true
          }
        }
      }
    }
  }

  /** Check if an item of given dimensions can fit in inventory */
  function canFit(w: number, h: number): boolean {
    refreshGrid()
    return findSpot(w, h) !== null
  }

  /** Find the first available spot for an item of given dimensions.
   *  Returns {x, y} grid coords or null if no space. */
  function findSpot(w: number, h: number): { x: number, y: number } | null {
    for (let r = 0; r <= ROWS - h; r++) {
      for (let c = 0; c <= COLS - w; c++) {
        let fits = true
        for (let dy = 0; dy < h && fits; dy++) {
          for (let dx = 0; dx < w && fits; dx++) {
            if (grid[r + dy]![c + dx]) fits = false
          }
        }
        if (fits) return { x: c, y: r }
      }
    }
    return null
  }

  /** Count free cells in inventory */
  function freeSpace(): number {
    refreshGrid()
    let count = 0
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!grid[r]![c]) count++
      }
    }
    return count
  }

  /** Check if inventory is full (less than 2 cells free) */
  function isFull(): boolean {
    return freeSpace() < 2
  }

  /** Get items in a specific container */
  function getItems(container: ItemContainer): ItemUnit[] {
    const result: ItemUnit[] = []
    for (const item of game.items) {
      if (item.location === container) result.push(item)
    }
    return result
  }

  /** Pick item to cursor from inventory/stash/cube — packet 0x19 */
  function* pickToCursor(item: ItemUnit) {
    const pkt = new Packet().byte(0x19).dword(item.unitId).toUint8Array()
    game.sendPacket(pkt)
    yield* game.delay(200)
  }

  /** Place item from cursor to inventory at position — packet 0x18 */
  function* placeCursor(targetX: number, targetY: number, container: number) {
    const pkt = bufferToStorage(0, targetX, targetY, container)
    game.sendPacket(pkt)
    yield* game.delay(200)
  }

  /** Move item to inventory (picks to cursor then places) */
  function* moveToInventory(item: ItemUnit) {
    const w = getItemWidth(item)
    const h = getItemHeight(item)
    refreshGrid()
    const spot = findSpot(w, h)
    if (!spot) {
      game.log(`[inv] no space for ${item.code} (${w}x${h})`)
      return false
    }

    yield* pickToCursor(item)
    yield* placeCursor(spot.x, spot.y, 0) // 0 = inventory
    return true
  }

  /** Move item to stash */
  function* moveToStash(item: ItemUnit) {
    yield* pickToCursor(item)
    // Stash: container 4, position 0,0 (auto-placement)
    yield* placeCursor(0, 0, 4)
    return true
  }

  /** Move item to cube */
  function* moveToCube(item: ItemUnit) {
    yield* pickToCursor(item)
    yield* placeCursor(0, 0, 3)
    return true
  }

  /** Deposit gold to stash */
  function* depositGold(amount?: number) {
    const gold = game.gold
    const toDeposit = amount ?? gold
    if (toDeposit <= 0) return
    // Packet 0x50: interact with stash → deposit gold
    const pkt = new Packet().byte(0x50).byte(0x01).dword(toDeposit).toUint8Array()
    game.sendPacket(pkt)
    yield* game.delay(200)
  }

  /** Should we deposit gold? (from Ryuk: charlvl * 1125) */
  function shouldDepositGold(): boolean {
    const threshold = game.charLevel * 1125
    return game.gold > threshold
  }

  return {
    refreshGrid,
    canFit,
    findSpot,
    freeSpace,
    isFull,
    getItems,
    pickToCursor,
    placeCursor,
    moveToInventory,
    moveToStash,
    moveToCube,
    depositGold,
    shouldDepositGold,
    get grid() { refreshGrid(); return grid },
  }
})

// Item dimension helpers — read from ItemStatCost txt
function getItemWidth(item: ItemUnit): number {
  // invwidth from items.txt
  const w = txtReadFieldU(4, item.classid, 0x114, 1) // offset 0x114 = invwidth
  return w > 0 ? w : 1
}

function getItemHeight(item: ItemUnit): number {
  const h = txtReadFieldU(4, item.classid, 0x115, 1) // offset 0x115 = invheight
  return h > 0 ? h : 1
}
