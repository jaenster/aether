
export enum SkillGet {
    RightName = 0,
        LeftName = 1,
        RightId = 2,
        LeftId = 3,
        AllSkills = 4
}
export enum SkillHand {
    Right=  0,
        Left=  1,
        LeftNoShift=  2,
        RightShift=  3,
}

export enum SkillSubIndex {
    HardPoints = 0,
        SoftPoints = 1
}

export enum Skill {

    // General
    Attack= 0,
        Kick= 1,
        Throw= 2,
        Unsummon= 3,
        LeftHandThrow= 4,
        LeftHandSwing= 5,

        // Amazon
        MagicArrow= 6,
        FireArrow= 7,
        InnerSight= 8,
        CriticalStrike= 9,
        Jab= 10,
        ColdArrow= 11,
        MultipleShot= 12,
        Dodge= 13,
        PowerStrike= 14,
        PoisonJavelin= 15,
        ExplodingArrow= 16,
        SlowMissiles= 17,
        Avoid= 18,
        Impale= 19,
        LightningBolt= 20,
        IceArrow= 21,
        GuidedArrow= 22,
        Penetrate= 23,
        ChargedStrike= 24,
        PlagueJavelin= 25,
        Strafe= 26,
        ImmolationArrow= 27,
        Dopplezon= 28,
        Decoy= 28,
        Evade= 29,
        Fend= 30,
        FreezingArrow= 31,
        Valkyrie= 32,
        Pierce= 33,
        LightningStrike= 34,
        LightningFury= 35,

        // Sorc
        FireBolt= 36,
        Warmth= 37,
        ChargedBolt= 38,
        IceBolt= 39,
        FrozenArmor= 40,
        Inferno= 41,
        StaticField= 42,
        Telekinesis= 43,
        FrostNova= 44,
        IceBlast= 45,
        Blaze= 46,
        FireBall= 47,
        Nova= 48,
        Lightning= 49,
        ShiverArmor= 50,
        FireWall= 51,
        Enchant= 52,
        ChainLightning= 53,
        Teleport= 54,
        GlacialSpike= 55,
        Meteor= 56,
        ThunderStorm= 57,
        EnergyShield= 58,
        Blizzard= 59,
        ChillingArmor= 60,
        FireMastery= 61,
        Hydra= 62,
        LightningMastery= 63,
        FrozenOrb= 64,
        ColdMastery= 65,

        // Necro
        AmplifyDamage= 66,
        Teeth= 67,
        BoneArmor= 68,
        SkeletonMastery= 69,
        RaiseSkeleton= 70,
        DimVision= 71,
        Weaken= 72,
        PoisonDagger= 73,
        CorpseExplosion= 74,
        ClayGolem= 75,
        IronMaiden= 76,
        Terror= 77,
        BoneWall= 78,
        GolemMastery= 79,
        RaiseSkeletalMage= 80,
        Confuse= 81,
        LifeTap= 82,
        PoisonExplosion= 83,
        BoneSpear= 84,
        BloodGolem= 85,
        Attract= 86,
        Decrepify= 87,
        BonePrison= 88,
        SummonResist= 89,
        IronGolem= 90,
        LowerResist= 91,
        PoisonNova= 92,
        BoneSpirit= 93,
        FireGolem= 94,
        Revive= 95,

        // Paladin
        Sacrifice= 96,
        Smite= 97,
        Might= 98,
        Prayer= 99,
    ResistFire= 100,
    HolyBolt= 101,
    HolyFire= 102,
    Thorns= 103,
    Defiance= 104,
    ResistCold= 105,
    Zeal= 106,
    Charge= 107,
    BlessedAim= 108,
    Cleansing= 109,
    ResistLightning= 110,
    Vengeance= 111,
    BlessedHammer= 112,
    Concentration= 113,
    HolyFreeze= 114,
    Vigor= 115,
    Conversion= 116,
    HolyShield= 117,
    HolyShock= 118,
    Sanctuary= 119,
    Meditation= 120,
    FistoftheHeavens= 121,
    Fanaticism= 122,
    Conviction= 123,
    Redemption= 124,
    Salvation= 125,

    // Barb
    Bash= 126,
    SwordMastery= 127,
    AxeMastery= 128,
    MaceMastery= 129,
    Howl= 130,
    FindPotion= 131,
    Leap= 132,
    DoubleSwing= 133,
    PoleArmMastery= 134,
    ThrowingMastery= 135,
    SpearMastery= 136,
    Taunt= 137,
    Shout= 138,
    Stun= 139,
    DoubleThrow= 140,
    IncreasedStamina= 141,
    FindItem= 142,
    LeapAttack= 143,
    Concentrate= 144,
    IronSkin= 145,
    BattleCry= 146,
    Frenzy= 147,
    IncreasedSpeed= 148,
    BattleOrders= 149,
    GrimWard= 150,
    Whirlwind= 151,
    Berserk= 152,
    NaturalResistance= 153,
    WarCry= 154,
    BattleCommand= 155,

    // General stuff
    IdentifyScroll= 217,
    BookofIdentify= 218,
    TownPortalScroll= 219,
    BookofTownPortal= 220,

    // Druid
    Raven= 221,
    PoisonCreeper= 222, // External
    PlaguePoppy= 222, // Internal
    Werewolf= 223, // External
    Wearwolf= 223, // Internal
    Lycanthropy= 224, // External
    ShapeShifting= 224, // Internal
    Firestorm= 225,
    OakSage= 226,
    SpiritWolf= 227, // External
    SummonSpiritWolf= 227, // Internal
    Werebear= 228, // External
    Wearbear= 228, // Internal
    MoltenBoulder= 229,
    ArcticBlast= 230,
    CarrionVine= 231, // External
    CycleofLife= 231, // Internal
    FeralRage= 232,
    Maul= 233,
    Fissure= 234, // Internal
    Eruption= 234, // Internal
    CycloneArmor= 235,
    HeartofWolverine= 236,
    SummonDireWolf= 237, // External
    SummonFenris= 237, // Internal
    Rabies= 238,
    FireClaws= 239,
    Twister= 240,
    SolarCreeper= 241, // External
    Vines= 241, // Internal
    Hunger= 242,
    ShockWave= 243,
    Volcano= 244,
    Tornado= 245,
    SpiritofBarbs= 246,
    Grizzly= 247, // External
    SummonGrizzly= 247, // Internal
    Fury= 248,
    Armageddon= 249,
    Hurricane= 250,

    // Assa
    FireBlast= 251, // External
    FireTrauma= 251, // Internal
    ClawMastery= 252,
    PsychicHammer= 253,
    TigerStrike= 254,
    DragonTalon= 255,
    ShockWeb= 256, // External
    ShockField= 256, // Internal
    BladeSentinel= 257,
    Quickness= 258, // Internal name
    BurstofSpeed= 258, // Shown name
    FistsofFire= 259,
    DragonClaw= 260,
    ChargedBoltSentry= 261,
    WakeofFire= 262, // External
    WakeofFireSentry= 262, // Internal
    WeaponBlock= 263,
    CloakofShadows= 264,
    CobraStrike= 265,
    BladeFury= 266,
    Fade= 267,
    ShadowWarrior= 268,
    ClawsofThunder= 269,
    DragonTail= 270,
    LightningSentry= 271,
    WakeofInferno= 272, // External
    InfernoSentry= 272, // Internal
    MindBlast= 273,
    BladesofIce= 274,
    DragonFlight= 275,
    DeathSentry= 276,
    BladeShield= 277,
    Venom= 278,
    ShadowMaster= 279,
    PhoenixStrike= 280, // External
    RoyalStrike= 280, // Internal
    WakeofDestructionSentry= 281, // Not used?
    Summoner= 500, // special
}

export enum SkillTabs {
    // Ama
    BowandCrossbow = 0,
        PassiveandMagic = 1,
        JavelinandSpear = 2,

        // Sorc
        Fire = 8,
        Lightning = 9,
        Cold = 10,

        // Necro
        Curses = 16,
        PoisonandBone = 17,
        NecroSummoning = 18,

        // Pala
        PalaCombat = 24,
        Offensive = 25,
        Defensive = 26,

        // Barb
        BarbCombat = 32,
        Masteries = 33,
        Warcries = 34,

        // Druid
        DruidSummon = 40,
        ShapeShifting = 41,
        Elemental = 42,

        // Assa
        Traps = 48,
        ShadowDisciplines = 49,
        MartialArts = 50,
}