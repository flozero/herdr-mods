import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { writeFileSync, renameSync } from "node:fs";

const [portFile, cwd, command, ...args] = process.argv.slice(2);
const IDLE_MS = 30000;

const server = createServer((socket) => {
  clearTimeout(idle);
  server.close();
  const lsp = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "ignore"] });
  lsp.stdout.pipe(socket);
  socket.pipe(lsp.stdin);
  const stop = () => {
    lsp.kill();
    socket.destroy();
    process.exit(0);
  };
  socket.on("close", stop);
  socket.on("error", stop);
  lsp.on("exit", stop);
  lsp.on("error", stop);
});

const idle = setTimeout(() => process.exit(1), IDLE_MS);

server.listen(0, "127.0.0.1", () => {
  writeFileSync(`${portFile}.tmp`, String(server.address().port));
  renameSync(`${portFile}.tmp`, portFile);
});
