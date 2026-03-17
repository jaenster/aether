import {
  drawAlloc, drawFree, drawUpdate, drawSetText,
} from "diablo:native"

// ── Types ───────────────────────────────────────────────────────────

export interface DrawHookOptions {
  color?: number
  alpha?: number
  visible?: boolean
  automap?: boolean
}

export interface LineOptions extends DrawHookOptions {
  x: number; y: number
  x2: number; y2: number
}

export interface BoxOptions extends DrawHookOptions {
  x: number; y: number
  w: number; h: number
}

export interface TextOptions extends DrawHookOptions {
  text: string
  x: number; y: number
  font?: number
}

// ── Base class ──────────────────────────────────────────────────────

// Native draw type/target constants
const TYPE_LINE = 0, TYPE_RECT = 1, TYPE_TEXT = 2
const TARGET_SCREEN = 0, TARGET_AUTOMAP = 1

export abstract class DrawHook {
  /** @internal native slot index */
  protected _slot: number
  private _removed = false
  private _color: number
  private _alpha: number
  private _visible: boolean

  constructor(nativeType: number, opts: DrawHookOptions = {}) {
    this._color = opts.color ?? 0
    this._alpha = opts.alpha ?? 0xFF
    this._visible = opts.visible ?? true
    this._slot = drawAlloc(nativeType, opts.automap ? TARGET_AUTOMAP : TARGET_SCREEN)
  }

  get color() { return this._color }
  set color(v: number) { this._color = v; this._sync() }

  get alpha() { return this._alpha }
  set alpha(v: number) { this._alpha = v; this._sync() }

  get visible() { return this._visible }
  set visible(v: boolean) { this._visible = v; this._sync() }

  remove(): void {
    if (this._removed) return
    this._removed = true
    drawFree(this._slot)
  }

  /** @internal push current state to native */
  protected abstract _sync(): void
}

// ── Concrete types ──────────────────────────────────────────────────

export class Line extends DrawHook {
  private _x: number; private _y: number; private _x2: number; private _y2: number

  constructor(opts: LineOptions) {
    super(TYPE_LINE, opts)
    this._x = opts.x; this._y = opts.y
    this._x2 = opts.x2; this._y2 = opts.y2
    this._sync()
  }

  get x() { return this._x }; set x(v: number) { this._x = v; this._sync() }
  get y() { return this._y }; set y(v: number) { this._y = v; this._sync() }
  get x2() { return this._x2 }; set x2(v: number) { this._x2 = v; this._sync() }
  get y2() { return this._y2 }; set y2(v: number) { this._y2 = v; this._sync() }

  protected _sync() {
    drawUpdate(this._slot, this._x, this._y, this._x2, this._y2, this.color, this.alpha, this.visible ? 1 : 0)
  }
}

export class Box extends DrawHook {
  private _x: number; private _y: number; private _w: number; private _h: number

  constructor(opts: BoxOptions) {
    super(TYPE_RECT, opts)
    this._x = opts.x; this._y = opts.y
    this._w = opts.w; this._h = opts.h
    this._sync()
  }

  get x() { return this._x }; set x(v: number) { this._x = v; this._sync() }
  get y() { return this._y }; set y(v: number) { this._y = v; this._sync() }
  get w() { return this._w }; set w(v: number) { this._w = v; this._sync() }
  get h() { return this._h }; set h(v: number) { this._h = v; this._sync() }

  protected _sync() {
    drawUpdate(this._slot, this._x, this._y, this._w, this._h, this.color, this.alpha, this.visible ? 1 : 0)
  }
}

export class Text extends DrawHook {
  private _text: string; private _x: number; private _y: number; private _font: number

  constructor(opts: TextOptions) {
    super(TYPE_TEXT, opts)
    this._text = opts.text; this._x = opts.x; this._y = opts.y
    this._font = opts.font ?? 0
    this._sync()
    drawSetText(this._slot, this._text)
  }

  get text() { return this._text }
  set text(v: string) { this._text = v; drawSetText(this._slot, v) }
  get x() { return this._x }; set x(v: number) { this._x = v; this._sync() }
  get y() { return this._y }; set y(v: number) { this._y = v; this._sync() }
  get font() { return this._font }; set font(v: number) { this._font = v; this._sync() }

  protected _sync() {
    // x2 stores font for text entries
    drawUpdate(this._slot, this._x, this._y, this._font, 0, this.color, this.alpha, this.visible ? 1 : 0)
  }
}
