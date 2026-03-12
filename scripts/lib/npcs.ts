import { Area } from "diablo:game"

export interface NpcInfo {
  name: string
  classid: number
  area: Area
  services: NpcService[]
}

export const enum NpcService {
  Trade,
  Repair,
  Heal,
  Gamble,
  Identify,
  Stash,
  Waypoint,
  Resurrect,
}

// ─── Act 1 ─────────────────────────────────────────────────────────

const Akara: NpcInfo = {
  name: "Akara",
  classid: 148,
  area: Area.RogueEncampment,
  services: [NpcService.Trade, NpcService.Heal],
}

const Charsi: NpcInfo = {
  name: "Charsi",
  classid: 154,
  area: Area.RogueEncampment,
  services: [NpcService.Trade, NpcService.Repair],
}

const Gheed: NpcInfo = {
  name: "Gheed",
  classid: 147,
  area: Area.RogueEncampment,
  services: [NpcService.Gamble],
}

const Kashya: NpcInfo = {
  name: "Kashya",
  classid: 150,
  area: Area.RogueEncampment,
  services: [NpcService.Resurrect],
}

const Cain1: NpcInfo = {
  name: "Deckard Cain",
  classid: 146,
  area: Area.RogueEncampment,
  services: [NpcService.Identify],
}

// ─── Act 2 ─────────────────────────────────────────────────────────

const Fara: NpcInfo = {
  name: "Fara",
  classid: 178,
  area: Area.LutGholein,
  services: [NpcService.Trade, NpcService.Repair, NpcService.Heal],
}

const Drognan: NpcInfo = {
  name: "Drognan",
  classid: 177,
  area: Area.LutGholein,
  services: [NpcService.Trade],
}

const Elzix: NpcInfo = {
  name: "Elzix",
  classid: 199,
  area: Area.LutGholein,
  services: [NpcService.Gamble],
}

const Lysander: NpcInfo = {
  name: "Lysander",
  classid: 202,
  area: Area.LutGholein,
  services: [NpcService.Trade],
}

const Atma: NpcInfo = {
  name: "Atma",
  classid: 176,
  area: Area.LutGholein,
  services: [NpcService.Heal],
}

const Greiz: NpcInfo = {
  name: "Greiz",
  classid: 198,
  area: Area.LutGholein,
  services: [NpcService.Resurrect],
}

const Cain2: NpcInfo = {
  name: "Deckard Cain",
  classid: 244,
  area: Area.LutGholein,
  services: [NpcService.Identify],
}

// ─── Act 3 ─────────────────────────────────────────────────────────

const Ormus: NpcInfo = {
  name: "Ormus",
  classid: 255,
  area: Area.KurastDocks,
  services: [NpcService.Trade, NpcService.Heal],
}

const Hratli: NpcInfo = {
  name: "Hratli",
  classid: 253,
  area: Area.KurastDocks,
  services: [NpcService.Trade, NpcService.Repair],
}

const Alkor: NpcInfo = {
  name: "Alkor",
  classid: 254,
  area: Area.KurastDocks,
  services: [NpcService.Gamble],
}

const Asheara: NpcInfo = {
  name: "Asheara",
  classid: 252,
  area: Area.KurastDocks,
  services: [NpcService.Resurrect],
}

const Cain3: NpcInfo = {
  name: "Deckard Cain",
  classid: 245,
  area: Area.KurastDocks,
  services: [NpcService.Identify],
}

// ─── Act 4 ─────────────────────────────────────────────────────────

const Halbu: NpcInfo = {
  name: "Halbu",
  classid: 257,
  area: Area.PandemoniumFortress,
  services: [NpcService.Trade, NpcService.Repair],
}

const Jamella: NpcInfo = {
  name: "Jamella",
  classid: 405,
  area: Area.PandemoniumFortress,
  services: [NpcService.Trade, NpcService.Gamble, NpcService.Heal],
}

const Tyrael: NpcInfo = {
  name: "Tyrael",
  classid: 367,
  area: Area.PandemoniumFortress,
  services: [NpcService.Resurrect],
}

const Cain4: NpcInfo = {
  name: "Deckard Cain",
  classid: 246,
  area: Area.PandemoniumFortress,
  services: [NpcService.Identify],
}

// ─── Act 5 ─────────────────────────────────────────────────────────

const Larzuk: NpcInfo = {
  name: "Larzuk",
  classid: 511,
  area: Area.Harrogath,
  services: [NpcService.Trade, NpcService.Repair],
}

const Malah: NpcInfo = {
  name: "Malah",
  classid: 513,
  area: Area.Harrogath,
  services: [NpcService.Trade, NpcService.Heal],
}

const Anya: NpcInfo = {
  name: "Anya",
  classid: 512,
  area: Area.Harrogath,
  services: [NpcService.Trade, NpcService.Gamble],
}

const QualKehk: NpcInfo = {
  name: "Qual-Kehk",
  classid: 515,
  area: Area.Harrogath,
  services: [NpcService.Resurrect],
}

const Cain5: NpcInfo = {
  name: "Deckard Cain",
  classid: 527,
  area: Area.Harrogath,
  services: [NpcService.Identify],
}

// ─── Lookup tables ─────────────────────────────────────────────────

/** All NPCs indexed by area */
const npcsByArea: Record<number, NpcInfo[]> = {
  [Area.RogueEncampment]: [Akara, Charsi, Gheed, Kashya, Cain1],
  [Area.LutGholein]: [Fara, Drognan, Elzix, Lysander, Atma, Greiz, Cain2],
  [Area.KurastDocks]: [Ormus, Hratli, Alkor, Asheara, Cain3],
  [Area.PandemoniumFortress]: [Halbu, Jamella, Tyrael, Cain4],
  [Area.Harrogath]: [Larzuk, Malah, Anya, QualKehk, Cain5],
}

/** Find the best NPC for a given service in a town area */
export function findNpc(area: Area, service: NpcService): NpcInfo | undefined {
  const npcs = npcsByArea[area]
  if (!npcs) return undefined
  return npcs.find(n => n.services.includes(service))
}

/** Get all NPCs in a town area */
export function getNpcs(area: Area): NpcInfo[] {
  return npcsByArea[area] ?? []
}

/** Healing NPCs also sell potions — prefer them for restocking */
export function findHealNpc(area: Area): NpcInfo | undefined {
  return findNpc(area, NpcService.Heal)
}

export function findRepairNpc(area: Area): NpcInfo | undefined {
  return findNpc(area, NpcService.Repair)
}

export function findGambleNpc(area: Area): NpcInfo | undefined {
  return findNpc(area, NpcService.Gamble)
}

export function findTradeNpc(area: Area): NpcInfo | undefined {
  return findNpc(area, NpcService.Trade)
}
