import React from "react";
import { useDaemon } from "./hooks/useDaemon";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { ClientList } from "./components/ClientList";
import { ServiceRegistry } from "./components/ServiceRegistry";
import { StarterPanel } from "./components/StarterPanel";
import { CommandSender } from "./components/CommandSender";
import { MessageLog } from "./components/MessageLog";
import { ScriptManager } from "./components/ScriptManager";
import "./app.css";

export function App() {
  const daemon = useDaemon();

  return (
    <>
      <ConnectionStatus
        browserConnected={daemon.connected}
        daemonConnected={daemon.state.daemonConnected}
        clientCount={daemon.state.clients.length}
        onReconnect={daemon.reconnectDaemon}
        onRefresh={daemon.refreshClients}
        onPing={daemon.pingDaemon}
      />

      <div className="grid">
        <ClientList clients={daemon.state.clients} />
        <ServiceRegistry
          services={daemon.state.services}
          onReloadScripts={() => daemon.reloadScripts()}
        />
        <StarterPanel
          services={daemon.state.services}
          sendToClient={daemon.sendToClient}
        />
        <ScriptManager onReload={daemon.reloadScripts} />
        <CommandSender
          clients={daemon.state.clients}
          onSend={daemon.sendToClient}
        />
        <MessageLog
          entries={daemon.state.messageLog}
          onClear={daemon.clearLog}
        />
      </div>
    </>
  );
}
