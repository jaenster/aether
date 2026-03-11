import { test, assert, assertNotEqual } from "diablo:test"

test("character is in game", function*(game) {
  assert(game.inGame, "Expected to be in game")
  game.log("  char: " + game.player.charname)
  game.log("  area: " + game.area + " act: " + game.act)
  game.log("  pos:  " + game.player.x + "," + game.player.y)
})

test("character has valid stats", function*(game) {
  assert(game.player.hpmax > 0, "Expected max HP > 0")
  assert(game.player.mpmax > 0, "Expected max MP > 0")
  game.log("  hp: " + game.player.hp + "/" + game.player.hpmax)
  game.log("  mp: " + game.player.mp + "/" + game.player.mpmax)
})

test("character name is EpicSorc", function*(game) {
  assert(game.player.charname === "EpicSorc", "Expected EpicSorc, got " + game.player.charname)
})

test("can read area exits", function*(game) {
  const exits = game.getExits()
  game.log("  exits: " + exits.length)
  for (const e of exits) {
    game.log("    area=" + e.area + " at " + e.x + "," + e.y)
  }
  // We should have at least one exit from any area
  assert(exits.length > 0, "Expected at least one exit")
})
