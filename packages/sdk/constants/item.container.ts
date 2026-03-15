/** Where an item is stored (container/page) — returned by item.location */
export const enum ItemContainer {
  Inventory = 0,
  Equipped = 1,
  Belt = 2,
  Cube = 3,
  Stash = 4,
  Ground = 5,
  Vendor = 6,
  Socketed = -1,
}
