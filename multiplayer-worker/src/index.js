import { DurableObject } from "cloudflare:workers";

const ROOM_CODE = /^\d{6}$/;

export default {
  async fetch(request, env) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const url = new URL(request.url);
    const room = url.searchParams.get("room") || "";
    if (!ROOM_CODE.test(room)) return new Response("Invalid room code", { status: 400 });
    const id = env.GAME_ROOM.idFromName(room);
    return env.GAME_ROOM.get(id).fetch(request);
  }
};

export class GameRoom extends DurableObject {
  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  sockets() { return this.ctx.getWebSockets(); }
  send(ws, data) { try { ws.send(JSON.stringify(data)); } catch {} }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); }
    catch { this.send(ws, { type: "error", message: "メッセージを読み取れませんでした" }); return; }

    let attachment = ws.deserializeAttachment() || { role: null };
    if (msg.type === "heartbeat") {
      this.send(ws, { type: "heartbeat-ack", sentAt: msg.sentAt || null });
      return;
    }

    if (msg.type === "create") {
      const hostExists = this.sockets().some(s => s !== ws && (s.deserializeAttachment() || {}).role === "host");
      if (hostExists || attachment.role) {
        this.send(ws, { type: "error", message: "この部屋はすでに使われています" });
        return;
      }
      ws.serializeAttachment({ role: "host" });
      this.send(ws, { type: "waiting" });
      return;
    }

    if (msg.type === "join") {
      const sockets = this.sockets();
      const host = sockets.find(s => s !== ws && (s.deserializeAttachment() || {}).role === "host");
      const guestExists = sockets.some(s => s !== ws && (s.deserializeAttachment() || {}).role === "guest");
      if (!host || guestExists || attachment.role) {
        this.send(ws, { type: "error", message: "部屋が見つからないか、満員です" });
        return;
      }
      ws.serializeAttachment({ role: "guest" });
      this.send(host, { type: "match-start", role: "host" });
      this.send(ws, { type: "match-start", role: "guest" });
      return;
    }

    if (msg.type === "resume") {
      const role = msg.role;
      if (role !== "host" && role !== "guest") {
        this.send(ws, { type: "error", message: "再接続情報を確認できませんでした" });
        return;
      }
      for (const oldSocket of this.sockets()) {
        if (oldSocket === ws) continue;
        const oldAttachment = oldSocket.deserializeAttachment() || {};
        if (oldAttachment.role === role) {
          oldSocket.serializeAttachment({ role: null });
          try { oldSocket.close(1000, "replaced by reconnect"); } catch {}
        }
      }
      ws.serializeAttachment({ role });
      const peerRole = role === "host" ? "guest" : "host";
      const peer = this.sockets().find(s => s !== ws && (s.deserializeAttachment() || {}).role === peerRole);
      if (peer) {
        this.send(peer, { type: "match-start", role: peerRole });
        this.send(ws, { type: "match-start", role });
      } else {
        this.send(ws, { type: "waiting" });
      }
    }
  }

  async webSocketClose(ws) {
    const role = (ws.deserializeAttachment() || {}).role;
    if (role) for (const peer of this.sockets()) if (peer !== ws) this.send(peer, { type: "opponent-left" });
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
    try { ws.close(1011, "socket error"); } catch {}
  }
}
