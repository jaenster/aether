export interface ClientInfo {
  clientId: string;
  name: string;
  type: string;
  capabilities: string[];
  state: Record<string, unknown>;
}

export interface ServiceRegister {
  type: "service:register";
  name: string;
  capabilities: string[];
}

export interface ServiceRegistered {
  type: "service:registered";
  clientId: string;
}

export interface ServiceDiscover {
  type: "service:discover";
  id: string;
  filterType?: string;
  filterCapability?: string;
}

export interface ServiceDiscoverResult {
  type: "service:discover:result";
  id: string;
  clients: ClientInfo[];
}
