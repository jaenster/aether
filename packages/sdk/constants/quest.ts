/** Quest IDs (0-based index into quest array per act) */
export const enum Quest {
  // Act 1
  DenOfEvil = 0,
  SistersBurialGrounds = 1,
  ToolsOfTheTrade = 2,
  TheSearchForCain = 3,
  TheForgottenTower = 4,
  SistersToTheSlaughter = 5,

  // Act 2
  RadamentsLair = 6,
  TheHoradricStaff = 7,
  TaintedSun = 8,
  ArcaneSanctuary = 9,
  TheSummoner = 10,
  TheSevenTombs = 11,

  // Act 3
  LamEsensTome = 12,
  KhalimsWill = 13,
  BladeOfTheOldReligion = 14,
  TheGoldenBird = 15,
  TheBlackenedTemple = 16,
  TheGuardian = 17,

  // Act 4
  TheFallenAngel = 18,
  TerrorsEnd = 19,
  HellsForge = 20,

  // Act 5
  SiegeOnHarrogath = 21,
  RescueOnMountArreat = 22,
  PrisonOfIce = 23,
  BetrayalOfHarrogath = 24,
  RiteOfPassage = 25,
  EveOfDestruction = 26,
}

/** Quest state bit IDs (sub-quest flags within each quest's 16-bit block) */
export const enum QuestState {
  /** Quest completed successfully */
  Completed = 0,
  /** Quest requirements met (ready to complete) */
  RequirementsMet = 1,
  /** Quest started / given by NPC */
  Started = 2,
  /** Quest reward available */
  RewardAvailable = 4,
  /** Quest reward granted */
  RewardGranted = 5,
  /** Quest closed (completed, reward consumed) */
  Closed = 12,
  /** Quest done (final state) */
  Done = 13,
}
