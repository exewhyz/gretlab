/* Runs student JavaScript in a background worker, with the parts of Node that programs use
   for input and output: require("fs").readFileSync(0), readline, process.stdin and
   process.stdout, console, and require() of the student's own files. A program that never
   stops is killed by the page (the worker is terminated and restarted). */

const EXIT = { exit: true };

function inspect(value, depth, seen) {
  depth = depth || 0;
  seen = seen || new Set();
  if (value === null) return "null";
  const type = typeof value;
  if (type === "string") return depth === 0 ? value : "'" + value.replace(/'/g, "\\'") + "'";
  if (type === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (type === "bigint") return value + "n";
  if (type === "undefined" || type === "boolean" || type === "symbol") return String(value);
  if (type === "function") return value.name ? "[Function: " + value.name + "]" : "[Function (anonymous)]";
  if (seen.has(value)) return "[Circular *1]";
  if (depth > 2) return Array.isArray(value) ? "[Array]" : "[Object]";
  seen.add(value);
  try {
    if (value instanceof Error) return value.stack || String(value);
    if (Array.isArray(value)) {
      if (!value.length) return "[]";
      const items = value.map((v) => inspect(v, depth + 1, seen));
      return wrap("[", items, "]");
    }
    if (value instanceof Map) {
      const items = [...value].map(([k, v]) => inspect(k, depth + 1, seen) + " => " + inspect(v, depth + 1, seen));
      return "Map(" + value.size + ") " + (items.length ? wrap("{", items, "}") : "{}");
    }
    if (value instanceof Set) {
      const items = [...value].map((v) => inspect(v, depth + 1, seen));
      return "Set(" + value.size + ") " + (items.length ? wrap("{", items, "}") : "{}");
    }
    const keys = Object.keys(value);
    if (!keys.length) return "{}";
    const items = keys.map((k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : "'" + k + "'") + ": " + inspect(value[k], depth + 1, seen));
    return wrap("{", items, "}");
  } finally {
    seen.delete(value);
  }
}

function wrap(open, items, close) {
  const line = open + " " + items.join(", ") + " " + close;
  return line.length <= 72 ? line : open + "\n  " + items.join(",\n  ") + "\n" + close;
}

function format(args) {
  if (typeof args[0] === "string" && /%[sdifjoO%]/.test(args[0])) {
    let i = 1;
    const first = args[0].replace(/%([sdifjoO%])/g, (m, c) => {
      if (c === "%") return "%";
      if (i >= args.length) return m;
      const v = args[i++];
      if (c === "s") return typeof v === "string" ? v : inspect(v, 1);
      if (c === "d" || c === "i") return String(c === "i" ? parseInt(v, 10) : Number(v));
      if (c === "f") return String(parseFloat(v));
      return inspect(v, 1);
    });
    return [first].concat(args.slice(i).map((a) => inspect(a))).join(" ");
  }
  return args.map((a) => inspect(a)).join(" ");
}

function emitter() {
  const handlers = {};
  return {
    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); return this; },
    once(name, fn) { const self = this; function once() { self.off(name, once); fn.apply(null, arguments); } return this.on(name, once); },
    off(name, fn) { handlers[name] = (handlers[name] || []).filter((h) => h !== fn); return this; },
    emit(name) { const args = [].slice.call(arguments, 1); (handlers[name] || []).slice().forEach((h) => h.apply(null, args)); return true; },
  };
}

function run(files, entry, input) {
  let out = "";
  let err = "";
  let failed = false;
  let pending = 0;
  let done = false;
  let finish = null;
  const finished = new Promise((resolve) => { finish = resolve; });

  const fail = (e) => {
    if (e === EXIT) return;
    failed = true;
    const text = e && e.stack ? String(e.stack) : String(e);
    err += text.replace(/\n\s+at .*(blob:|eval|js-worker)[\s\S]*$/m, "").trim() + "\n";
  };

  const console = {
    log: (...a) => { out += format(a) + "\n"; },
    info: (...a) => { out += format(a) + "\n"; },
    debug: (...a) => { out += format(a) + "\n"; },
    error: (...a) => { err += format(a) + "\n"; },
    warn: (...a) => { err += format(a) + "\n"; },
    table: (v) => { out += inspect(v) + "\n"; },
  };

  // Input arrives after the program's first pass, the way Node delivers it.
  const stdin = emitter();
  stdin.setEncoding = () => stdin;
  stdin.resume = () => stdin;
  stdin.pause = () => stdin;
  stdin.fd = 0;
  let stdinUsed = false;
  const origOn = stdin.on;
  stdin.on = function (name, fn) { stdinUsed = true; return origOn.call(this, name, fn); };

  const process = {
    argv: ["node", entry],
    env: {},
    platform: "linux",
    version: "v22.0.0",
    versions: { node: "22.0.0" },
    exitCode: 0,
    stdin,
    stdout: { write: (s) => { out += String(s); return true; } },
    stderr: { write: (s) => { err += String(s); return true; } },
    exit: (code) => { if (code) failed = true; throw EXIT; },
    on: () => process,
    nextTick: (fn, ...args) => Promise.resolve().then(() => guard(() => fn(...args))),
    hrtime: Object.assign(() => [0, 0], { bigint: () => BigInt(Math.round(performance.now() * 1e6)) }),
    memoryUsage: () => ({ heapUsed: 0, rss: 0 }),
  };

  const guard = (fn) => {
    if (done) return;
    try { fn(); } catch (e) { fail(e); if (e === EXIT) settle(); }
  };

  const timers = new Map();
  let timerId = 0;
  const setTimeoutW = (fn, ms, ...args) => {
    const id = ++timerId;
    pending++;
    timers.set(id, self.setTimeout(() => { timers.delete(id); pending--; guard(() => fn(...args)); check(); }, ms));
    return id;
  };
  const clearTimeoutW = (id) => { if (timers.has(id)) { self.clearTimeout(timers.get(id)); timers.delete(id); pending--; check(); } };
  const intervals = new Map();
  const setIntervalW = (fn, ms, ...args) => {
    const id = ++timerId;
    pending++;
    intervals.set(id, self.setInterval(() => guard(() => fn(...args)), ms));
    return id;
  };
  const clearIntervalW = (id) => { if (intervals.has(id)) { self.clearInterval(intervals.get(id)); intervals.delete(id); pending--; check(); } };

  function readAll(fd) {
    if (fd === 0 || fd === "/dev/stdin") return input;
    const file = files.find((f) => f.path === String(fd).replace(/^\.\//, ""));
    if (file) return file.content;
    const e = new Error("ENOENT: no such file or directory, open '" + fd + "'");
    e.code = "ENOENT";
    throw e;
  }

  const readline = {
    createInterface() {
      const rl = emitter();
      const lines = input.length ? input.replace(/\r/g, "").replace(/\n$/, "").split("\n") : [];
      rl.close = () => { if (!rl.closed) { rl.closed = true; rl.emit("close"); } };
      rl.question = (q, cb) => { out += q; const line = lines.shift(); setTimeoutW(() => cb(line === undefined ? "" : line), 0); };
      rl.setPrompt = () => {};
      rl.prompt = () => {};
      rl[Symbol.asyncIterator] = async function* () { while (lines.length) yield lines.shift(); };
      setTimeoutW(() => {
        while (lines.length && !rl.closed) rl.emit("line", lines.shift());
        rl.close();
      }, 0);
      return rl;
    },
  };

  const builtins = {
    fs: { readFileSync: (fd) => readAll(fd), existsSync: (p) => files.some((f) => f.path === String(p).replace(/^\.\//, "")) },
    readline,
    util: { inspect: (v) => inspect(v, 1), format: (...a) => format(a) },
    process,
    os: { EOL: "\n" },
  };

  const cache = new Map();
  function load(path, from) {
    const bare = path.replace(/^node:/, "");
    if (builtins[bare]) return builtins[bare];
    const base = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
    const parts = (base + path).split("/");
    const stack = [];
    for (const p of parts) { if (p === "..") stack.pop(); else if (p && p !== ".") stack.push(p); }
    const name = stack.join("/");
    const file = [name, name + ".js", name + ".cjs", name + "/index.js"].map((n) => files.find((f) => f.path === n)).find(Boolean);
    if (!file) throw new Error("Cannot find module '" + path + "'");
    if (cache.has(file.path)) return cache.get(file.path).exports;
    const mod = { exports: {} };
    cache.set(file.path, mod);
    const fn = new Function("require", "module", "exports", "console", "process", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "__filename", "__dirname",
      file.content + "\n//# sourceURL=" + file.path);
    fn((p) => load(p, file.path), mod, mod.exports, console, process, setTimeoutW, clearTimeoutW, setIntervalW, clearIntervalW, (f, ...a) => setTimeoutW(f, 0, ...a), "/" + file.path, "/" + base.replace(/\/$/, ""));
    return mod.exports;
  }

  function check() {
    if (!done && pending === 0) self.setTimeout(() => { if (!done && pending === 0) settle(); }, 0);
  }
  function settle() {
    if (done) return;
    done = true;
    timers.forEach((t) => self.clearTimeout(t));
    intervals.forEach((t) => self.clearInterval(t));
    finish({ out, err: err.trimEnd(), failed });
  }

  self.onunhandledrejection = (event) => { event.preventDefault(); fail(event.reason); };

  try {
    const result = load("./" + entry, "");
    void result;
  } catch (e) {
    fail(e);
    if (e === EXIT) { settle(); return finished; }
  }
  // Data and end events, once the program has had its first pass.
  if (!done) {
    pending++;
    self.setTimeout(() => {
      pending--;
      if (stdinUsed) {
        guard(() => { if (input) stdin.emit("data", input); });
        guard(() => { stdin.emit("end"); stdin.emit("close"); });
      }
      check();
    }, 0);
  }
  return finished;
}

self.postMessage({ type: "ready" });

self.onmessage = async (ev) => {
  const { id, files, entry, input } = ev.data;
  try {
    const res = await run(files, entry, input);
    self.postMessage({ type: "result", id, res });
  } catch (e) {
    self.postMessage({ type: "result", id, res: { out: "", err: "The JavaScript engine stopped unexpectedly: " + (e && e.message ? e.message : e), failed: true } });
  }
};
