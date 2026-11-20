// One cache file. Each open of the window is a new copy of the mod with an empty localStorage,
// so everything fetched goes to a hidden file in the mod folder and shows first next time.
// Writes are batched and done by flush().

import * as fs from "fs/promises";

export class Store {
  constructor(dir, exec) {
    this.dir = dir;
    this.exec = exec;
    this.path = `${dir}/data.json`;
    this.data = {};
    this.changed = new Set();
    this.writing = false;
  }

  async read() {
    try { return JSON.parse(await fs.readFile(this.path, "utf8")) ?? {}; }
    catch { return {}; }
  }

  async load() {
    this.data = await this.read();
    return this.data;
  }

  get(key, fallback) { return this.data[key] ?? fallback; }
  set(key, value) { this.data[key] = value; this.changed.add(key); }

  async flush() {
    if (!this.changed.size || this.writing) return;
    const keys = [...this.changed];
    this.changed.clear();
    this.writing = true;
    const tmp = `${this.path}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await this.exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", this.dir]);
      const disk = await this.read();
      for (const k of keys) disk[k] = this.data[k];
      await fs.writeFile(tmp, JSON.stringify(disk));
      const r = await this.exec("mv", ["-f", tmp, this.path]);
      if (r.code !== 0) throw new Error(r.stderr);
    } catch {
      for (const k of keys) if (!this.changed.has(k)) this.changed.add(k);
      await this.exec("rm", ["-f", tmp]).catch(() => {});
    } finally {
      this.writing = false;
    }
  }
}

export class JsonFile {
  constructor(dir, name, exec) {
    this.dir = dir;
    this.path = `${dir}/${name}`;
    this.exec = exec;
  }

  async read(fallback) {
    try { return JSON.parse(await fs.readFile(this.path, "utf8")) ?? fallback; }
    catch { return fallback; }
  }

  async write(value) {
    const tmp = `${this.path}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    await this.exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "sh", this.dir]);
    await fs.writeFile(tmp, JSON.stringify(value));
    const r = await this.exec("mv", ["-f", tmp, this.path]);
    if (r.code !== 0) throw new Error(r.stderr);
  }
}
