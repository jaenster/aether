export interface MessageSend {
  type: "message:send";
  targetId: string;
  payload: unknown;
}

export interface MessageIncoming {
  type: "message:incoming";
  fromId: string;
  fromName: string;
  payload: unknown;
}

export interface MessageBroadcast {
  type: "message:broadcast";
  filterType?: string;
  payload: unknown;
}
