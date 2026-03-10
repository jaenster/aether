import type { AetherServer, ConnectedClient } from "./server.js";

export class Registry {
  constructor(private server: AetherServer) {
    server.on("service:register", (client, msg) => this.handleRegister(client, msg));
    server.on("service:discover", (client, msg) => this.handleDiscover(client, msg));
    server.on("state:update", (client, msg) => this.handleStateUpdate(client, msg));
  }

  private handleRegister(client: ConnectedClient, msg: Record<string, unknown>): void {
    if (msg.name) client.name = msg.name as string;
    if (msg.capabilities) client.capabilities = msg.capabilities as string[];

    client.ws.send(JSON.stringify({
      type: "service:registered",
      clientId: client.id,
    }));
    console.log(`Service registered: ${client.name} [${client.capabilities.join(", ")}]`);
  }

  private handleDiscover(client: ConnectedClient, msg: Record<string, unknown>): void {
    const filterType = msg.filterType as string | undefined;
    const filterCap = msg.filterCapability as string | undefined;

    let clients = this.server.getClients();
    if (filterType) clients = clients.filter(c => c.type === filterType);
    if (filterCap) clients = clients.filter(c => c.capabilities.includes(filterCap));

    client.ws.send(JSON.stringify({
      type: "service:discover:result",
      id: msg.id,
      clients: clients.map(c => ({
        clientId: c.id,
        name: c.name,
        type: c.type,
        capabilities: c.capabilities,
        state: c.state,
      })),
    }));
  }

  private handleStateUpdate(client: ConnectedClient, msg: Record<string, unknown>): void {
    if (msg.state && typeof msg.state === "object") {
      Object.assign(client.state, msg.state);
    }
  }
}
