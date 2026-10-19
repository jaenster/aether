//! Process-wide state that both the injector and an embedding host set, read by
//! the bindings. No patching lives here.

/// A player unit exists and the game loop runs.
pub var in_game: bool = false;

/// Started with --headless: nothing is drawn.
pub var headless: bool = false;
