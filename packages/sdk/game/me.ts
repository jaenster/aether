export interface Me {
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly hpmax: number;
  readonly mp: number;
  readonly mpmax: number;
  readonly name: string;

  getStat(stat: number, layer?: number): number;

  getState(state: number): boolean;
}
export declare const meProxy: Me;