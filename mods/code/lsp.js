import { connect } from "net";
import { Buffer } from "buffer";
import { exec, readTextFile } from "herdr";

const SEPARATOR = [13, 10, 13, 10];
const METHOD_NOT_FOUND = -32601;

export const fileUri = (path) => `file://${encodeURI(path)}`;
export const uriPath = (uri) => decodeURIComponent(String(uri).replace(/^file:\/\//, ""));

const separatorAt = (bytes) => {
  for (let i = 0; i + SEPARATOR.length <= bytes.length; i++) {
    if (SEPARATOR.every((byte, j) => bytes[i + j] === byte)) return i;
  }
  return -1;
};

const utf8 = (bytes) => Buffer.from(bytes).toString("utf8");

export async function launch({ bridge, cacheDir, root, command, sleep }) {
  const portFile = `${cacheDir}/lsp-${Date.now()}-${Math.random().toString(36).slice(2)}.port`;
  const script = 'port="$1"; bridge="$2"; root="$3"; shift 3; mkdir -p "$(dirname "$port")"; nohup node "$bridge" "$port" "$root" "$@" </dev/null >/dev/null 2>&1 &';
  await exec("sh", ["-c", script, "sh", portFile, bridge, root, ...command]);
  for (let waited = 0; waited < 120000; waited += 100) {
    const port = Number((await readTextFile(portFile).catch(() => null)) ?? "");
    if (port > 0) {
      await exec("rm", ["-f", portFile]);
      return new LspClient(await connect("127.0.0.1", port));
    }
    await sleep(100);
  }
  throw new Error(`${command[0]} did not start`);
}

export class LspClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.buffer = new Uint8Array(0);
    this.writing = Promise.resolve();
    this.closed = false;
    this.settings = () => null;
    this.pump();
  }

  on(method, listener) {
    this.listeners.set(method, listener);
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new Error("language server stopped"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params) {
    if (!this.closed) this.send({ jsonrpc: "2.0", method, params });
  }

  async initialize(root, settings, initializationOptions) {
    this.settings = settings;
    const result = await this.request("initialize", {
      processId: null,
      initializationOptions,
      rootUri: fileUri(root),
      workspaceFolders: [{ uri: fileUri(root), name: root.split("/").pop() }],
      capabilities: {
        general: { positionEncodings: ["utf-16"] },
        workspace: { configuration: true, workspaceFolders: true, workspaceEdit: { documentChanges: true } },
        textDocument: {
          synchronization: { didSave: true },
          completion: {
            contextSupport: true,
            completionItem: { snippetSupport: false, documentationFormat: ["markdown", "plaintext"] },
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          rename: { prepareSupport: false },
          publishDiagnostics: {},
        },
      },
    });
    this.notify("initialized", {});
    return result?.capabilities ?? {};
  }

  close() {
    if (this.closed) return;
    this.request("shutdown", null)
      .catch(() => null)
      .then(() => {
        this.notify("exit", null);
        this.socket.close();
      });
  }

  send(message) {
    const body = JSON.stringify(message);
    const frame = `Content-Length: ${Buffer.from(body, "utf8").length}\r\n\r\n${body}`;
    this.writing = this.writing.then(() => this.socket.write(frame)).catch(() => this.stop());
  }

  async pump() {
    for (;;) {
      let chunk;
      try {
        chunk = await this.socket.read(65536);
      } catch (error) {
        if (/timed out/i.test(String(error?.message ?? error)) && !this.closed) continue;
        break;
      }
      if (chunk === null) break;
      this.take(chunk);
    }
    this.stop();
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(new Error("language server stopped"));
    this.pending.clear();
    this.listeners.get("$/closed")?.();
  }

  take(chunk) {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;
    for (;;) {
      const headerEnd = separatorAt(this.buffer);
      if (headerEnd < 0) return;
      const length = Number(/content-length:\s*(\d+)/i.exec(utf8(this.buffer.subarray(0, headerEnd)))?.[1] ?? 0);
      const start = headerEnd + SEPARATOR.length;
      if (this.buffer.length < start + length) return;
      const body = utf8(this.buffer.subarray(start, start + length));
      this.buffer = this.buffer.slice(start + length);
      try {
        this.receive(JSON.parse(body));
      } catch {}
    }
  }

  receive(message) {
    if (message.method === undefined) {
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result ?? null);
      return;
    }
    if (message.id === undefined) {
      this.listeners.get(message.method)?.(message.params);
      return;
    }
    this.answer(message);
  }

  answer({ id, method, params }) {
    const reply = (result) => this.send({ jsonrpc: "2.0", id, result });
    if (method === "workspace/configuration") return reply((params?.items ?? []).map((item) => this.settings(item.section) ?? null));
    if (method === "workspace/workspaceFolders") return reply(null);
    if (method === "workspace/applyEdit") return reply({ applied: false });
    if (["client/registerCapability", "client/unregisterCapability", "window/workDoneProgress/create", "window/showMessageRequest"].includes(method)) return reply(null);
    this.send({ jsonrpc: "2.0", id, error: { code: METHOD_NOT_FOUND, message: `${method} is not supported` } });
  }
}
