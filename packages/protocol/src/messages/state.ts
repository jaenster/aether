export interface StateUpdate {
  type: "state:update";
  state: Record<string, unknown>;
}
