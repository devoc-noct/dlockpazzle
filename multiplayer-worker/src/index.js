import { DurableObject } from "cloudflare:workers";

const ROOM_CODE = /^\d{6}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") return new Response("Multiplayer WebSocket endpoint", { status: 200 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket upgrade required", { status: 426 });
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
  broadcast(data) { for (const ws of this.sockets()) this.send(ws, data); }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); }
    catch { this.send(ws, { type: "error", message: "メッセージを読み取れませんでした" }); return; }

    const attachment = ws.deserializeAttachment() || { role: null };
    if (msg.type === "create") {
      const existingHost = this.sockets().some(socket => (socket.deserializeAttachment() || {}).role === "host" && socket !== ws);
      if (existingHost || attachment.role) { this.send(ws, { type: "error", message: "この部屋はすでに使われています" }); return; }
      ws.serializeAttachment({ role: "host" });
      this.send(ws, { type: "waiting" });
      return;
    }

    if (msg.type === "join") {
      const sockets = this.sockets();
      const host = sockets.find(socket => socket !== ws && (socket.deserializeAttachment() || {}).role === "host");
      const guestAlready = sockets.some(socket => socket !== ws && (socket.deserializeAttachment() || {}).role === "guest");
      if (!host || guestAlready || attachment.role) { this.send(ws, { type: "error", message: "部屋が見つからないか、満員です" }); return; }
      ws.serializeAttachment({ role: "guest" });
      this.send(host, { type: "match-start", role: "host" });
      this.send(ws, { type: "match-start", role: "guest" });
      return;
    }

    if (msg.type === "state") {
      if (!["host", "guest"].includes(attachment.role)) return;
      const score = Math.max(0, Math.min(999999999, Number(msg.score) || 0));
      const lines = Math.max(0, Math.min(999999, Number(msg.lines) || 0));
      const level = Math.max(1, Math.min(999, Number(msg.level) || 1));
      for (const peer of this.sockets()) {
        if (peer !== ws) this.send(peer, { type: "opponent-state", score, lines, level, gameOver: !!msg.gameOver });
      }
    }
  }

  async webSocketClose(ws) {
    const role = (ws.deserializeAttachment() || {}).role;
    if (role) {
      for (const peer of this.sockets()) if (peer !== ws) this.send(peer, { type: "opponent-left" });
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
    try { ws.close(1011, "socket error"); } catch {}
  }
}
