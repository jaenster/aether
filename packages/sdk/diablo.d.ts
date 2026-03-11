
// Type declarations for diablo: scheme modules
// These modules use a custom URL scheme like node:fs

declare module "diablo:native" {
  export * from './native/index.js'
}

declare module "diablo:game" {
  export * from './game/index.js'
}


declare module "diablo:constants" {
  export * from './constants/index.js'
}

declare module "diablo:test" {
  export * from './test/index.js'
}

declare module "diablo:test-runner" {
  // This module is the test runner bootstrap, imported as entry point for tests
  // It doesn't export anything - it sets up the test runner automatically
}

