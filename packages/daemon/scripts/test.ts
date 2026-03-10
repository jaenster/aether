import { log, getArea, getDifficulty, inGame, getUnitStat } from "diablo:native";
import { getBaseStat } from "./lib/txt.js";
import { skillDamage, monsterEffort } from "./lib/game-data.js";

log("=== Aether Damage Calculator ===");

let tested = false;

(globalThis as any).__onTick = () => {
  if (tested || !inGame()) return;
  tested = true;

  const area = getArea();
  const diff = getDifficulty();
  const clvl = getUnitStat(12, 0);
  log("area=" + area + " diff=" + diff + " clvl=" + clvl);

  // Test txt reading — Fallen (classid 4)
  const fallenLvl = getBaseStat("monstats", 4, "Level");
  const fallenFireRes = getBaseStat("monstats", 4, "ResFi");
  log("Fallen(4): lvl=" + fallenLvl + " fireRes=" + fallenFireRes);

  // Test skill reading — fire bolt (36)
  const fbEType = getBaseStat("skills", 36, "EType");
  const fbEMin = getBaseStat("skills", 36, "EMin");
  const fbEMax = getBaseStat("skills", 36, "EMax");
  log("FireBolt(36): EType=" + fbEType + " EMin=" + fbEMin + " EMax=" + fbEMax);

  // Test damage calc for skills the player has
  const testSkills = [36, 47, 56, 49, 53, 59, 64, 84, 93, 112, 38, 39, 45, 55];
  for (const sk of testSkills) {
    const sl = getUnitStat(sk, 0);
    if (sl > 0) {
      const dmg = skillDamage(sk);
      log("Skill " + sk + " (lv" + sl + "): " + dmg.type +
          " phys=" + dmg.pmin + "-" + dmg.pmax +
          " elem=" + dmg.min + "-" + dmg.max);
    }
  }

  // Test monster effort against fallen
  const effort = monsterEffort(4, area);
  log("Effort vs Fallen: skill=" + effort.skill + " effort=" + effort.effort + " type=" + effort.type);
};
