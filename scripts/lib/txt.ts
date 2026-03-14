import { txtReadField, txtReadFieldU } from "diablo:native";

// Table IDs matching native binding (must match Zig txtLookup switch)
const TBL_MONSTATS = 0;
const TBL_SKILLS = 1;
const TBL_LEVELS = 2;
const TBL_MISSILES = 3;
const TBL_ITEMS = 4;
const TBL_MONSTATS2 = 5;
const TBL_STATES = 6;
const TBL_ITEMSTATCOST = 7;
const TBL_CHARSTATS = 8;
const TBL_OBJECTS = 9;
const TBL_SUPERUNIQUES = 10;
const TBL_EXPERIENCE = 11;
const TBL_DIFFICULTYLEVELS = 12;
const TBL_UNIQUEITEMS = 13;
const TBL_SETITEMS = 14;
const TBL_ITEMTYPES = 15;
const TBL_PROPERTIES = 16;
const TBL_OVERLAY = 17;
const TBL_SHRINES = 18;
const TBL_QUALITYITEMS = 19;
const TBL_MAGICAFFIXES = 20;
const TBL_NPC = 21;
const TBL_LEVELDEFS = 22;
const TBL_LVLPREST = 23;

// D2MonStatsTxt field offsets (struct size: 0x1A8 = 424 bytes)
// Verified against Ghidra D2MonStatsTxt struct definition.
// Layout: difficulty variants are grouped by stat (val, valN, valH), NOT interleaved (min, max).
// e.g. HP: MinHP(176), MinHPN(178), MinHPH(180), MaxHP(182), MaxHPN(184), MaxHPH(186)
const monStatsFields: Record<string, [number, number, boolean?]> = {
  // [offset, size, unsigned?]
  Id:           [0x000, 2, true],   // 0
  BaseId:       [0x002, 2],         // 2
  NextInClass:  [0x004, 2],         // 4
  NameStr:      [0x006, 2, true],   // 6
  DescStr:      [0x008, 2, true],   // 8
  // flags at 0x00C (bitfield, read as i32)
  flags:        [0x00C, 4],         // 12
  Code:         [0x010, 4],         // 16
  MonSound:     [0x014, 2],         // 20
  UMonSound:    [0x016, 2],         // 22
  MonStatsEx:   [0x018, 2],         // 24
  MonProp:      [0x01A, 2],         // 26
  MonType:      [0x01C, 2],         // 28
  AI:           [0x01E, 2],         // 30
  Spawn:        [0x020, 2],         // 32
  SpawnX:       [0x022, 1],         // 34
  SpawnY:       [0x023, 1],         // 35
  SpawnMode:    [0x024, 1],         // 36
  minion1:      [0x026, 2],         // 38
  minion2:      [0x028, 2],         // 40
  nMonEquipId:  [0x02A, 2],         // 42
  PartyMin:     [0x02C, 1],         // 44
  PartyMax:     [0x02D, 1],         // 45
  Rarity:       [0x02E, 1, true],   // 46
  MinGrp:       [0x02F, 1, true],   // 47
  MaxGrp:       [0x030, 1, true],   // 48
  Velocity:     [0x032, 2],         // 50
  Run:          [0x034, 2],         // 52
  // Missiles
  MissA1:       [0x03A, 2],         // 58
  MissA2:       [0x03C, 2],         // 60
  MissS1:       [0x03E, 2],         // 62
  MissS2:       [0x040, 2],         // 64
  MissS3:       [0x042, 2],         // 66
  MissS4:       [0x044, 2],         // 68
  MissC:        [0x046, 2],         // 70
  MissSQ:       [0x048, 2],         // 72
  Align:        [0x04C, 1],         // 76
  TransLvl:     [0x04D, 1],         // 77
  threat:       [0x04E, 1, true],   // 78
  aidel:        [0x04F, 1],         // 79
  "aidel(N)":   [0x050, 1],         // 80
  "aidel(H)":   [0x051, 1],         // 81
  aidist:       [0x052, 1],         // 82
  "aidist(N)":  [0x053, 1],         // 83
  "aidist(H)":  [0x054, 1],         // 84
  // Drain effectiveness (offset 160-162)
  Drain:        [0x0A0, 1],         // 160
  "Drain(N)":   [0x0A1, 1],         // 161
  "Drain(H)":   [0x0A2, 1],         // 162
  // Block (offset 163-165)
  ToBlock:      [0x0A3, 1, true],   // 163
  "ToBlock(N)": [0x0A4, 1, true],   // 164
  "ToBlock(H)": [0x0A5, 1, true],   // 165
  Crit:         [0x0A6, 1],         // 166
  SkillDamage:  [0x0A8, 2],         // 168
  // Level per difficulty (offset 170-174)
  Level:        [0x0AA, 2],         // 170
  "Level(N)":   [0x0AC, 2],         // 172
  "Level(H)":   [0x0AE, 2],         // 174
  // HP: min grouped, then max grouped (offset 176-186)
  minHP:        [0x0B0, 2, true],   // 176
  "minHP(N)":   [0x0B2, 2, true],   // 178
  "minHP(H)":   [0x0B4, 2, true],   // 180
  maxHP:        [0x0B6, 2, true],   // 182
  "maxHP(N)":   [0x0B8, 2, true],   // 184
  "maxHP(H)":   [0x0BA, 2, true],   // 186
  // AC per difficulty (offset 188-192)
  AC:           [0x0BC, 2],         // 188
  "AC(N)":      [0x0BE, 2],         // 190
  "AC(H)":      [0x0C0, 2],         // 192
  // Attack Rating: A1TH, A2TH, S1TH (offset 194-210)
  A1TH:         [0x0C2, 2],         // 194
  "A1TH(N)":    [0x0C4, 2],         // 196
  "A1TH(H)":    [0x0C6, 2],         // 198
  A2TH:         [0x0C8, 2],         // 200
  "A2TH(N)":    [0x0CA, 2],         // 202
  "A2TH(H)":    [0x0CC, 2],         // 204
  S1TH:         [0x0CE, 2],         // 206
  "S1TH(N)":    [0x0D0, 2],         // 208
  "S1TH(H)":    [0x0D2, 2],         // 210
  // Experience (offset 212-216)
  Exp:          [0x0D4, 2, true],   // 212
  "Exp(N)":     [0x0D6, 2, true],   // 214
  "Exp(H)":     [0x0D8, 2, true],   // 216
  // Damage: A1Min grouped, then A1Max grouped (offset 218-252)
  A1MinD:       [0x0DA, 2, true],   // 218
  "A1MinD(N)":  [0x0DC, 2, true],   // 220
  "A1MinD(H)":  [0x0DE, 2, true],   // 222
  A1MaxD:       [0x0E0, 2, true],   // 224
  "A1MaxD(N)":  [0x0E2, 2, true],   // 226
  "A1MaxD(H)":  [0x0E4, 2, true],   // 228
  A2MinD:       [0x0E6, 2, true],   // 230
  "A2MinD(N)":  [0x0E8, 2, true],   // 232
  "A2MinD(H)":  [0x0EA, 2, true],   // 234
  A2MaxD:       [0x0EC, 2, true],   // 236
  "A2MaxD(N)":  [0x0EE, 2, true],   // 238
  "A2MaxD(H)":  [0x0F0, 2, true],   // 240
  S1MinD:       [0x0F2, 2, true],   // 242
  "S1MinD(N)":  [0x0F4, 2, true],   // 244
  "S1MinD(H)":  [0x0F6, 2, true],   // 246
  S1MaxD:       [0x0F8, 2, true],   // 248
  "S1MaxD(N)":  [0x0FA, 2, true],   // 250
  "S1MaxD(H)":  [0x0FC, 2, true],   // 252
  // Elemental damage on attacks (offset 254-322)
  El1Mode:      [0x0FE, 1],         // 254 — which attack: 1=A1, 2=A2, 4=S1
  El2Mode:      [0x0FF, 1],         // 255
  El3Mode:      [0x100, 1],         // 256
  El1Type:      [0x101, 1],         // 257 — element: 1=fire, 2=lightning, 3=magic, 4=cold, 5=poison
  El2Type:      [0x102, 1],         // 258
  El3Type:      [0x103, 1],         // 259
  El1Pct:       [0x104, 1, true],   // 260
  "El1Pct(N)":  [0x105, 1, true],   // 261
  "El1Pct(H)":  [0x106, 1, true],   // 262
  El2Pct:       [0x107, 1, true],   // 263
  "El2Pct(N)":  [0x108, 1, true],   // 264
  "El2Pct(H)":  [0x109, 1, true],   // 265
  El3Pct:       [0x10A, 1, true],   // 266
  "El3Pct(N)":  [0x10B, 1, true],   // 267
  "El3Pct(H)":  [0x10C, 1, true],   // 268
  El1MinD:      [0x10E, 2],         // 270
  "El1MinD(N)": [0x110, 2],         // 272
  "El1MinD(H)": [0x112, 2],         // 274
  El2MinD:      [0x114, 2],         // 276
  "El2MinD(N)": [0x116, 2],         // 278
  "El2MinD(H)": [0x118, 2],         // 280
  El3MinD:      [0x11A, 2],         // 282
  "El3MinD(N)": [0x11C, 2],         // 284
  "El3MinD(H)": [0x11E, 2],         // 286
  El1MaxD:      [0x120, 2],         // 288
  "El1MaxD(N)": [0x122, 2],         // 290
  "El1MaxD(H)": [0x124, 2],         // 292
  El2MaxD:      [0x126, 2],         // 294
  "El2MaxD(N)": [0x128, 2],         // 296
  "El2MaxD(H)": [0x12A, 2],         // 298
  El3MaxD:      [0x12C, 2],         // 300
  "El3MaxD(N)": [0x12E, 2],         // 302
  "El3MaxD(H)": [0x130, 2],         // 304
  El1Dur:       [0x132, 2],         // 306
  "El1Dur(N)":  [0x134, 2],         // 308
  "El1Dur(H)":  [0x136, 2],         // 310
  El2Dur:       [0x138, 2],         // 312
  "El2Dur(N)":  [0x13A, 2],         // 314
  "El2Dur(H)":  [0x13C, 2],         // 316
  El3Dur:       [0x13E, 2],         // 318
  "El3Dur(N)":  [0x140, 2],         // 320
  "El3Dur(H)":  [0x142, 2],         // 322
  // Resistances (offset 324-358)
  ResDm:        [0x144, 2],         // 324
  "ResDm(N)":   [0x146, 2],         // 326
  "ResDm(H)":   [0x148, 2],         // 328
  ResMa:        [0x14A, 2],         // 330
  "ResMa(N)":   [0x14C, 2],         // 332
  "ResMa(H)":   [0x14E, 2],         // 334
  ResFi:        [0x150, 2],         // 336
  "ResFi(N)":   [0x152, 2],         // 338
  "ResFi(H)":   [0x154, 2],         // 340
  ResLi:        [0x156, 2],         // 342
  "ResLi(N)":   [0x158, 2],         // 344
  "ResLi(H)":   [0x15A, 2],         // 346
  ResCo:        [0x15C, 2],         // 348
  "ResCo(N)":   [0x15E, 2],         // 350
  "ResCo(H)":   [0x160, 2],         // 352
  ResPo:        [0x162, 2],         // 354
  "ResPo(N)":   [0x164, 2],         // 356
  "ResPo(H)":   [0x166, 2],         // 358
  // Cold effect (offset 360-363)
  ColdEffect:   [0x168, 1],         // 360
  "ColdEffect(N)": [0x169, 1],      // 361
  "ColdEffect(H)": [0x16A, 2],      // 362
  // SendSkills (offset 364)
  SendSkills:   [0x16C, 4, true],   // 364
  // Monster skills (offset 368-415)
  Skill1:       [0x170, 2],         // 368
  Skill2:       [0x172, 2],         // 370
  Skill3:       [0x174, 2],         // 372
  Skill4:       [0x176, 2],         // 374
  Skill5:       [0x178, 2],         // 376
  Skill6:       [0x17A, 2],         // 378
  Skill7:       [0x17C, 2],         // 380
  Skill8:       [0x17E, 2],         // 382
  Sk1mode:      [0x180, 1],         // 384
  Sk2mode:      [0x181, 1],         // 385
  Sk3mode:      [0x182, 1],         // 386
  Sk4mode:      [0x183, 1],         // 387
  Sk5mode:      [0x184, 1],         // 388
  Sk6mode:      [0x185, 1],         // 389
  Sk7mode:      [0x186, 1],         // 390
  Sk8mode:      [0x187, 1],         // 391
  Sk1seq:       [0x188, 2],         // 392
  Sk2seq:       [0x18A, 2],         // 394
  Sk3seq:       [0x18C, 2],         // 396
  Sk4seq:       [0x18E, 2],         // 398
  Sk5seq:       [0x190, 2],         // 400
  Sk6seq:       [0x192, 2],         // 402
  Sk7seq:       [0x194, 2],         // 404
  Sk8seq:       [0x196, 2],         // 406
  Sk1lvl:       [0x198, 1],         // 408
  Sk2lvl:       [0x199, 1],         // 409
  Sk3lvl:       [0x19A, 1],         // 410
  Sk4lvl:       [0x19B, 1],         // 411
  Sk5lvl:       [0x19C, 1],         // 412
  Sk6lvl:       [0x19D, 1],         // 413
  Sk7lvl:       [0x19E, 1],         // 414
  Sk8lvl:       [0x19F, 1],         // 415
  // DamageRegen (offset 416)
  DamageRegen:  [0x1A0, 4],         // 416
  // Flag fields (all read from the flags bitfield at 0x00C via monStatsFlagBits)
  neverCount:   [0x00C, 4],
  killable:     [0x00C, 4],
  isMelee:      [0x00C, 4],
  boss:         [0x00C, 4],
  primeevil:    [0x00C, 4],
  npc:          [0x00C, 4],
  lUndead:      [0x00C, 4],
  hUndead:      [0x00C, 4],
  demon:        [0x00C, 4],
  flying:       [0x00C, 4],
  switchai:     [0x00C, 4],
  petIgnore:    [0x00C, 4],
  deathDmg:     [0x00C, 4],
  RangedType:   [0x00C, 4],  // bit 4 of byte 15 = bit 28 of flags i32
};

// Bit positions for flag fields in the flags i32 at 0x00C
const monStatsFlagBits: Record<string, number> = {
  isSpawn: 0, isMelee: 1, noRatio: 2, opendoors: 3,
  SetBoss: 4, BossXfer: 5, boss: 6, primeevil: 7,
  npc: 8, interact: 9, inTown: 10, lUndead: 11,
  hUndead: 12, demon: 13, flying: 14, killable: 15,
  switchai: 16, nomultishot: 17, neverCount: 18, petIgnore: 19,
  deathDmg: 24, RangedType: 28,
};

// D2SkillsTxt field offsets (struct size: 0x23C)
const skillsFields: Record<string, [number, number, boolean?]> = {
  skill:        [0x000, 2],
  flags:        [0x004, 1, true],
  nFlags:       [0x006, 1, true],
  charclass:    [0x00C, 1],
  anim:         [0x010, 1],
  range:        [0x014, 1],
  SelectProc:   [0x015, 1],
  srvstfunc:    [0x02C, 2],
  srvdofunc:    [0x02E, 2],
  srvmissile:   [0x046, 2],
  srvmissilea:  [0x048, 2],
  srvmissileb:  [0x04A, 2],
  srvmissilec:  [0x04C, 2],
  aurafilter:   [0x050, 4],
  aurastate:    [0x080, 2],
  passivestate: [0x094, 2],
  cltmissile:   [0x0E8, 2],
  cltmissilea:  [0x0EA, 2],
  cltmissileb:  [0x0EC, 2],
  perdelay:     [0x128, 4],
  maxlvl:       [0x12C, 2],
  HitFlags:     [0x130, 4],
  Param1:       [0x148, 4],
  Param2:       [0x14C, 4],
  Param3:       [0x150, 4],
  Param4:       [0x154, 4],
  Param5:       [0x158, 4],
  Param6:       [0x15C, 4],
  Param7:       [0x160, 4],
  Param8:       [0x164, 4],
  reqlevel:     [0x174, 2],
  reqskill1:    [0x17E, 2],
  reqskill2:    [0x180, 2],
  reqskill3:    [0x182, 2],
  startmana:    [0x184, 2],
  minmana:      [0x186, 2],
  manashift:    [0x188, 2],
  mana:         [0x18A, 2],
  lvlmana:      [0x18C, 2],
  delay:        [0x190, 4],
  skilldesc:    [0x194, 2],
  ToHit:        [0x198, 4],
  LevToHit:     [0x19C, 4],
  HitShift:     [0x1A4, 1],
  SrcDam:       [0x1A5, 1, true],
  MinDam:       [0x1A8, 4],
  MaxDam:       [0x1AC, 4],
  MinLevDam1:   [0x1B0, 4],
  MinLevDam2:   [0x1B4, 4],
  MinLevDam3:   [0x1B8, 4],
  MinLevDam4:   [0x1BC, 4],
  MinLevDam5:   [0x1C0, 4],
  MaxLevDam1:   [0x1C4, 4],
  MaxLevDam2:   [0x1C8, 4],
  MaxLevDam3:   [0x1CC, 4],
  MaxLevDam4:   [0x1D0, 4],
  MaxLevDam5:   [0x1D4, 4],
  DmgSymPerCalc:[0x1D8, 4],
  EType:        [0x1DC, 4],
  EMin:         [0x1E0, 4],
  EMax:         [0x1E4, 4],
  EMinLev1:     [0x1E8, 4],
  EMinLev2:     [0x1EC, 4],
  EMinLev3:     [0x1F0, 4],
  EMinLev4:     [0x1F4, 4],
  EMinLev5:     [0x1F8, 4],
  EMaxLev1:     [0x1FC, 4],
  EMaxLev2:     [0x200, 4],
  EMaxLev3:     [0x204, 4],
  EMaxLev4:     [0x208, 4],
  EMaxLev5:     [0x20C, 4],
  EDmgSymPerCalc:[0x210, 4],
  ELen:         [0x214, 4],
  ELevLen1:     [0x218, 4],
  ELevLen2:     [0x21C, 4],
  ELevLen3:     [0x220, 4],
  ELenSymPerCalc:[0x224, 4],
  state1:       [0x22A, 2],
  state2:       [0x22C, 2],
  state3:       [0x22E, 2],
  aitype:       [0x230, 1],
  aibonus:      [0x232, 2],
  costmult:     [0x234, 4],
  costadd:      [0x238, 4],
};

// D2MissilesTxt field offsets (struct size: 420 = 0x1A4)
const missilesFields: Record<string, [number, number, boolean?]> = {
  Missile:    [0, 2, true],     // 0
  pCltDoFunc: [8, 2],           // 8
  pCltHitFunc:[10, 2],          // 10
  pSrvDoFunc: [12, 2],          // 12
  pSrvHitFunc:[14, 2],          // 14
  pSrvDmgFunc:[16, 2],          // 16
  TravelSound:[18, 2],          // 18
  HitSound:   [20, 2],          // 20
  ExplosionMissile: [22, 2],    // 22
  SubMissile1:[24, 2],          // 24
  SubMissile2:[26, 2],          // 26
  SubMissile3:[28, 2],          // 28
  HitSubMissile1: [38, 2],     // 38
  HitSubMissile2: [40, 2],     // 40
  HitSubMissile3: [42, 2],     // 42
  HitSubMissile4: [44, 2],     // 44
  Param1:     [56, 4],          // 56
  Param2:     [60, 4],          // 60
  Param3:     [64, 4],          // 64
  Param4:     [68, 4],          // 68
  Param5:     [72, 4],          // 72
  HitClass:   [148, 1],        // 148
  Range:      [150, 2],         // 150 — frames the missile lives
  LevRange:   [152, 2],         // 152
  Vel:        [154, 1],         // 154 — velocity (sub-tiles per frame)
  VelLev:     [155, 1],         // 155
  MaxVel:     [156, 1],         // 156
  Accel:      [158, 2],         // 158
  xoffset:    [162, 2],         // 162
  yoffset:    [164, 2],         // 164
  zoffset:    [166, 2],         // 166
  MinDamage:  [176, 4],         // 176
  MaxDamage:  [180, 4],         // 180
  EType:      [228, 1],         // 228
  EMin:       [232, 4],         // 232
  EMax:       [236, 4],         // 236
  Size:       [396, 1],         // 396
  Skill:      [404, 2],         // 404
  HitShift:   [406, 1],         // 406
};

// D2ItemsTxt field offsets (struct size: 424 = 0x1A8)
const itemsFields: Record<string, [number, number, boolean?]> = {
  szCode:     [128, 4],         // 128 — 4-char code as int
  dwNormCode: [132, 4],         // 132
  dwUberCode: [136, 4],         // 136
  dwUltraCode:[140, 4],         // 140
  wState:     [152, 2],         // 152
  wCState1:   [154, 2],         // 154
  wCState2:   [156, 2],         // 156
  dwMinAc:    [204, 4],         // 204
  dwMaxAc:    [208, 4],         // 208
  dwMinDam:   [212, 4],         // 212
  dwMaxDam:   [216, 4],         // 216
  dwCost:     [224, 4],         // 224
  wNameStr:   [244, 2, true],   // 244
  nRarity:    [252, 1, true],   // 252
  nLevel:     [253, 1, true],   // 253
  nLevelReq:  [254, 1, true],   // 254
  nStrBonus:  [260, 1],         // 260
  nDexBonus:  [261, 1],         // 261
  wType:      [286, 2, true],   // 286
  wType2:     [288, 2, true],   // 288
  nDurability:[292, 1, true],   // 292
  nSockets:   [294, 1, true],   // 294
  nSpeed:     [296, 1],         // 296
  nStackable: [300, 1],         // 300
  nMinStack:  [302, 2, true],   // 302
  nMaxStack:  [304, 2, true],   // 304
  wGemOffset: [306, 2],         // 306
  dwNightmareUpgrade:[412, 4],  // 412
  dwHellUpgrade:     [416, 4],  // 416
};

// D2MonStats2Txt field offsets (struct size: 308)
const monStats2Fields: Record<string, [number, number, boolean?]> = {
  Id:         [0, 2, true],     // 0
  SizeX:      [8, 1, true],     // 8
  SizeY:      [9, 1, true],     // 9
  MeleeRng:   [14, 1, true],    // 14
  BaseW:      [16, 4],          // 16
  TotalPieces:[236, 1, true],   // 236
};

// D2StatesTxt field offsets (struct size: 60)
const statesFields: Record<string, [number, number, boolean?]> = {
  state:      [0, 2, true],     // 0
  overlay1:   [2, 2],           // 2
  overlay2:   [4, 2],           // 4
  overlay3:   [6, 2],           // 6
  overlay4:   [8, 2],           // 8
  castoverlay:[10, 2],          // 10
  removerlay: [12, 2],          // 12
  stat:       [24, 2],          // 24
  setfunc:    [26, 2],          // 26
  remfunc:    [28, 2],          // 28
  group:      [30, 2],          // 30
  onsound:    [38, 2],          // 38
  skill:      [56, 2],          // 56
  missile:    [58, 2],          // 58
};

// D2ItemStatCostTxt field offsets (struct size: 324)
const itemStatCostFields: Record<string, [number, number, boolean?]> = {
  stat:       [0, 2, true],     // 0
  dwItemStatFlags:[4, 4, true], // 4
  sendBits:   [8, 1, true],     // 8
  sendParamBits:[9, 1, true],   // 9
  csvbits:    [10, 1, true],    // 10
  valshift:   [24, 1, true],    // 24
  saveBits:   [25, 1, true],    // 25
  saveAdd:    [28, 4],          // 28
  saveParamBits:[36, 4],        // 36
  encode:     [48, 1, true],    // 48
  descfunc:   [54, 1, true],    // 54
  op:         [84, 1, true],    // 84
};

// D2CharStatsTxt field offsets (struct size: 196)
const charStatsFields: Record<string, [number, number, boolean?]> = {
  str:        [48, 1, true],    // 48
  dex:        [49, 1, true],    // 49
  int:        [50, 1, true],    // 50
  vit:        [51, 1, true],    // 51
  stamina:    [52, 1, true],    // 52
  ToHitFactor:[60, 4],          // 60
  WalkVelocity:[64, 1, true],   // 64
  RunVelocity:[65, 1, true],    // 65
  StrAllSkills:[82, 2, true],   // 82
};

// D2ObjectsTxt field offsets (struct size: 448)
const objectsFields: Record<string, [number, number, boolean?]> = {
  Token:      [192, 2, true],   // 192
  SpawnMax:   [195, 1, true],   // 195
  SizeX:      [208, 4],         // 208
  SizeY:      [212, 4],         // 212
  IsAttackable:[296, 1, true],  // 296
  NameOffset: [360, 4],         // 360
  AutoMap:    [444, 4],         // 444
};

// D2SuperUniquesTxt field offsets (struct size: 52)
const superUniquesFields: Record<string, [number, number, boolean?]> = {
  Superunique:[0, 2, true],     // 0
  Name:       [2, 2, true],     // 2
  Class:      [4, 4],           // 4 — monster class ID
  hcIdx:      [8, 4],           // 8
  Mod1:       [12, 4],          // 12
  Mod2:       [16, 4],          // 16
  Mod3:       [20, 4],          // 20
  MonSound:   [24, 4],          // 24
  MinGrp:     [28, 4],          // 28
  MaxGrp:     [32, 4],          // 32
  AutoPos:    [36, 1, true],    // 36
  TC:         [44, 2, true],    // 44
  "TC(N)":    [46, 2, true],    // 46
  "TC(H)":    [48, 2, true],    // 48
};

// D2LevelsTxt field offsets (struct size: 544)
const levelsFields: Record<string, [number, number, boolean?]> = {
  Id:         [0, 1, true],     // 0
  Pal:        [2, 1, true],     // 2
  Act:        [3, 1, true],     // 3
  Teleport:   [4, 1, true],     // 4
  MonLvl:     [16, 2, true],    // 16 — normal
  "MonLvl(N)":[18, 2, true],    // 18
  "MonLvl(H)":[20, 2, true],    // 20
  MonLvlEx:   [22, 2, true],    // 22
  "MonLvlEx(N)":[24, 2, true],  // 24
  "MonLvlEx(H)":[26, 2, true],  // 26
  MonDen:     [28, 4],          // 28
  "MonDen(N)":[32, 4],          // 32
  "MonDen(H)":[36, 4],          // 36
  SoundEnv:   [540, 1, true],   // 540
};

// D2ExperienceTxt field offsets (struct size: 32)
// Each row = one level. 7 class columns + ExpRatio.
const experienceFields: Record<string, [number, number, boolean?]> = {
  Amazon:     [0, 4, true],     // 0
  Sorceress:  [4, 4, true],     // 4
  Necromancer:[8, 4, true],     // 8
  Paladin:    [12, 4, true],    // 12
  Barbarian:  [16, 4, true],    // 16
  Druid:      [20, 4, true],    // 20
  Assassin:   [24, 4, true],    // 24
  ExpRatio:   [28, 4, true],    // 28
};

// D2DifficultyLevelsTxt field offsets (struct size: 88)
const difficultyLevelsFields: Record<string, [number, number, boolean?]> = {
  ResistPenalty:     [0, 4],    // 0
  DeathExpPenalty:   [4, 4],    // 4
  MonsterSkillBonus: [16, 4],   // 16
  MonsterFreezeDivisor:[20, 4], // 20
  LifeStealDivisor:  [40, 4],  // 40
  StaticFieldMin:    [64, 4],   // 64
  GambleRare:        [68, 4],   // 68
  GambleUnique:      [76, 4],   // 76
};

// D2UniqueItemsTxt field offsets (struct size: 332)
const uniqueItemsFields: Record<string, [number, number, boolean?]> = {
  version:    [36, 2, true],    // 36
  code:       [40, 4],          // 40 — 4-char item code
  rarity:     [48, 2, true],    // 48
  lvl:        [52, 2, true],    // 52
  lvlReq:     [54, 2, true],    // 54
  costMult:   [124, 4],         // 124
  costAdd:    [128, 4],         // 128
};

// D2SetItemsTxt field offsets (struct size: 440)
const setItemsFields: Record<string, [number, number, boolean?]> = {
  nId:        [0, 2, true],     // 0
  version:    [34, 2, true],    // 34
  item:       [40, 4],          // 40 — 4-char item code
  set:        [44, 2, true],    // 44
  setIndex:   [46, 2, true],    // 46
  lvl:        [48, 2, true],    // 48
  lvlReq:     [50, 2, true],    // 50
  rarity:     [52, 4],          // 52
};

// D2ItemTypesTxt field offsets (struct size: 228)
const itemTypesFields: Record<string, [number, number, boolean?]> = {
  code:       [0, 4],           // 0 — 4-char type code
  equiv1:     [4, 2],           // 4
  equiv2:     [6, 2],           // 6
  repair:     [8, 1, true],     // 8
  body:       [9, 1, true],     // 9
  shoots:     [12, 2],          // 12
  quiver:     [14, 2],          // 14
  throwable:  [16, 1, true],    // 16
  charm:      [23, 1, true],    // 23
  gem:        [24, 1, true],    // 24
  beltable:   [25, 1, true],    // 25
  maxsock1:   [26, 1, true],    // 26 — max sockets lvl 1-25
  maxsock25:  [27, 1, true],    // 27 — max sockets lvl 25-40
  maxsock40:  [28, 1, true],    // 28 — max sockets lvl 40+
  staffmods:  [31, 1, true],    // 31
};

// D2PropertiesTxt field offsets (struct size: 46)
const propertiesFields: Record<string, [number, number, boolean?]> = {
  code:       [0, 2, true],     // 0
  set1:       [2, 1, true],     // 2
  val1:       [10, 2],          // 10
  func1:      [24, 1, true],    // 24
  stat1:      [32, 2],          // 32
};

const tableMap: Record<string, [number, Record<string, [number, number, boolean?]>]> = {
  monstats:        [TBL_MONSTATS, monStatsFields],
  skills:          [TBL_SKILLS, skillsFields],
  Skills:          [TBL_SKILLS, skillsFields],
  levels:          [TBL_LEVELS, levelsFields],
  missiles:        [TBL_MISSILES, missilesFields],
  items:           [TBL_ITEMS, itemsFields],
  monstats2:       [TBL_MONSTATS2, monStats2Fields],
  states:          [TBL_STATES, statesFields],
  itemstatcost:    [TBL_ITEMSTATCOST, itemStatCostFields],
  charstats:       [TBL_CHARSTATS, charStatsFields],
  objects:         [TBL_OBJECTS, objectsFields],
  superuniques:    [TBL_SUPERUNIQUES, superUniquesFields],
  experience:      [TBL_EXPERIENCE, experienceFields],
  difficultylevels:[TBL_DIFFICULTYLEVELS, difficultyLevelsFields],
  uniqueitems:     [TBL_UNIQUEITEMS, uniqueItemsFields],
  setitems:        [TBL_SETITEMS, setItemsFields],
  itemtypes:       [TBL_ITEMTYPES, itemTypesFields],
  properties:      [TBL_PROPERTIES, propertiesFields],
  overlay:         [TBL_OVERLAY, {}],
  shrines:         [TBL_SHRINES, {}],
  qualityitems:    [TBL_QUALITYITEMS, {}],
  magicaffixes:    [TBL_MAGICAFFIXES, {}],
  npc:             [TBL_NPC, {}],
  leveldefs:       [TBL_LEVELDEFS, {}],
  lvlprest:        [TBL_LVLPREST, {}],
};

export function getBaseStat(table: string, id: number, field: string): number {
  const entry = tableMap[table];
  if (!entry) return 0;

  const [tableId, fields] = entry;

  // Check if this is a flag field (monstats bitfield at 0x00C)
  if (tableId === TBL_MONSTATS && monStatsFlagBits[field] !== undefined) {
    const flags = txtReadField(tableId, id, 0x00C, 4);
    return (flags >> monStatsFlagBits[field]) & 1;
  }

  const fieldDef = fields[field];
  if (!fieldDef) return 0;

  const [offset, size, unsigned] = fieldDef;
  return unsigned ? txtReadFieldU(tableId, id, offset, size) : txtReadField(tableId, id, offset, size);
}

export {
  monStatsFields, skillsFields, missilesFields, itemsFields, monStats2Fields,
  statesFields, itemStatCostFields, charStatsFields, objectsFields,
  superUniquesFields, levelsFields, experienceFields, difficultyLevelsFields,
  uniqueItemsFields, setItemsFields, itemTypesFields, propertiesFields,
  monStatsFlagBits,
};
