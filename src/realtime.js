"use strict";
/* Real-time synchronisation over WebSockets (Socket.IO).
   Every successful mutation is broadcast to all connected, authenticated
   clients so each user instantly sees the latest data with no refresh. */
const { Server } = require("socket.io");
const { authenticate } = require("./auth");

let io = null;
const WARD_ROOM = "ward";

function initRealtime(httpServer){
  io = new Server(httpServer, {
    cors: { origin: (process.env.CORS_ORIGIN || "*").split(","), credentials: true }
  });

  // authenticate the socket handshake with the same JWT as REST
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      const user = await authenticate(token);
      socket.data.user = { id:user.id, name:user.name, role:user.role };
      next();
    } catch(e){ next(new Error(e.message || "unauthorized")); }
  });

  io.on("connection", (socket) => {
    socket.join(WARD_ROOM);
    const role = socket.data.user && socket.data.user.role;
    if(role === "admin" || role === "hod") socket.join("audit");   // live audit only for privileged
    broadcastPresence();
    socket.on("disconnect", () => broadcastPresence());
  });

  return io;
}

// {collection, op:'upsert'|'delete', record|id}
function broadcast(collection, op, payload){
  if(!io) return;
  io.to(WARD_ROOM).emit("change", { collection, op, ...payload, at: Date.now() });
}
function broadcastAudit(entry){ if(io) io.to("audit").emit("audit", entry); }
function broadcastConfig(config){ if(io) io.to(WARD_ROOM).emit("config", config); }
function broadcastUsers(){ if(io) io.to(WARD_ROOM).emit("users-changed", { at: Date.now() }); }

function broadcastPresence(){
  if(!io) return;
  const room = io.sockets.adapter.rooms.get(WARD_ROOM);
  const ids = [];
  if(room){ room.forEach(sid => { const s = io.sockets.sockets.get(sid); if(s && s.data.user) ids.push(s.data.user); }); }
  io.to(WARD_ROOM).emit("presence", { online: ids, count: ids.length });
}

module.exports = { initRealtime, broadcast, broadcastAudit, broadcastConfig, broadcastUsers, broadcastPresence };
