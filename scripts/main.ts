import { createBot } from "diablo:game"

export default createBot('monitor', function*(game) {
  while (true) {
    if (game.inGame) {
      game.log(`[${game.me.charname}] area=${game.area} pos=${game.me.x},${game.me.y}`)

      const nearby = game.monsters.filter(m => m.distance < 30)
      if (nearby.length) {
        const closest = game.monsters.closest()
        game.log(`  ${nearby.length} monsters nearby, closest: ${closest?.name} (${closest?.classid}) d=${closest?.distance.toFixed(1)}`)
      }

      const items = game.items.toArray()
      if (items.length) {
        game.log(`  ${items.length} items visible`)
      }

      const tiles = game.tiles.toArray()
      if (tiles.length) {
        game.log(`  ${tiles.length} tiles, dest: ${tiles.map(t => t.destArea).join(',')}`)
      }
    } else {
      game.log('waiting for game...')
    }
    yield* game.delay(3000)
  }
})
