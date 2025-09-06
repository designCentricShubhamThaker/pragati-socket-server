  import express from "express";
  import http from "http";
  import { Server } from "socket.io";
  import cors from "cors";

  import glassSockets from "./sockets/glassSockets.js";

  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PATCH"],
    },
  });

  app.use(cors());
  app.use(express.json());


  app.get("/", (req, res) => {
    res.send("Backend with Modular Sockets Running ✅");
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    glassSockets(io, socket);

    socket.on("joinRoom", (roomName) => {
      console.log(roomName,"room")
      if (typeof roomName === "string" && roomName.trim() !== "") {
        socket.join(roomName);
        console.log(`Socket ${socket.id} joined room: ${roomName}`);
      } else {
        console.log(`Socket ${socket.id} tried to join invalid room: ${roomName}`);
      }
    });


    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
  });