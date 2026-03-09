export interface Hello {
  type: "hello";
  protocolVersion: number;
  clientType: "game" | "extension" | "cli";
  clientName: string;
}

export interface Welcome {
  type: "welcome";
  protocolVersion: number;
  clientId: string;
  daemonVersion: string;
}
