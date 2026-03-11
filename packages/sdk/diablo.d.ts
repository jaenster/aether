
// Type declarations for diablo: scheme modules
// These modules use a custom URL scheme like node:fs
// Actual type resolution is handled via "paths" in each project's tsconfig.json

declare module "diablo:test-runner" {
  // This module is the test runner bootstrap, imported as entry point for tests
  // It doesn't export anything - it sets up the test runner automatically
}
