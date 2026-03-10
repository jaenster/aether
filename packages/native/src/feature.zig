pub const Hooks = struct {
    // Lifecycle
    init: ?*const fn () void = null,
    deinit: ?*const fn () void = null,

    // Logic loops (run every frame, separate from rendering)
    gameLoop: ?*const fn () void = null,
    oogLoop: ?*const fn () void = null,

    // Drawing — game
    gameUnitPreDraw: ?*const fn () void = null,
    gameUnitPostDraw: ?*const fn () void = null,
    gameAutomapPreDraw: ?*const fn () void = null,
    gameAutomapPostDraw: ?*const fn () void = null,
    preDraw: ?*const fn () void = null,
    gamePostDraw: ?*const fn () void = null,

    // Drawing — OOG + shared
    oogPostDraw: ?*const fn () void = null,
    allPostDraw: ?*const fn () void = null,

    // Input
    keyEvent: ?*const fn (u32, bool, u32) bool = null,
    mouseEvent: ?*const fn (i32, i32, u8, bool) bool = null, // x, y, button(0=L,1=R,2=M), down
};

var features: [32]*const Hooks = undefined;
var count: u8 = 0;
pub var in_game: bool = false;

pub fn register(hooks: *const Hooks) void {
    features[count] = hooks;
    count += 1;
}

pub fn initAll() void {
    for (features[0..count]) |f| {
        if (f.init) |cb| cb();
    }
}

pub fn deinitAll() void {
    var i: u8 = count;
    while (i > 0) {
        i -= 1;
        if (features[i].deinit) |cb| cb();
    }
}

fn Dispatch(comptime field_name: []const u8) type {
    return struct {
        pub fn run() void {
            for (features[0..count]) |f| {
                if (@field(f, field_name)) |cb| cb();
            }
        }
    };
}

pub const dispatchGameLoop = Dispatch("gameLoop").run;
pub const dispatchOogLoop = Dispatch("oogLoop").run;
pub const dispatchGameUnitPreDraw = Dispatch("gameUnitPreDraw").run;
pub const dispatchGameUnitPostDraw = Dispatch("gameUnitPostDraw").run;
pub const dispatchGameAutomapPreDraw = Dispatch("gameAutomapPreDraw").run;
pub const dispatchGameAutomapPostDraw = Dispatch("gameAutomapPostDraw").run;
pub const dispatchPreDraw = Dispatch("preDraw").run;
pub const dispatchGamePostDraw = Dispatch("gamePostDraw").run;
pub const dispatchOogPostDraw = Dispatch("oogPostDraw").run;
pub const dispatchAllPostDraw = Dispatch("allPostDraw").run;

pub fn dispatchKeyEvent(key: u32, down: bool, flags: u32) bool {
    for (features[0..count]) |f| {
        if (f.keyEvent) |cb| {
            if (!cb(key, down, flags)) return false;
        }
    }
    return true;
}

pub fn dispatchMouseEvent(x: i32, y: i32, button: u8, down: bool) bool {
    // Dispatch in reverse order so later-registered features (overlays) get first priority
    var i: u8 = count;
    while (i > 0) {
        i -= 1;
        if (features[i].mouseEvent) |cb| {
            if (!cb(x, y, button, down)) return false;
        }
    }
    return true;
}
