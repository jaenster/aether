export interface ScriptLoaded {
  type: "script:loaded";
  path: string;
  moduleCount: number;
}

export interface ScriptError {
  type: "script:error";
  path: string;
  error: string;
  line?: number;
  column?: number;
}

export interface ScriptReload {
  type: "script:reload";
  path?: string;
}
