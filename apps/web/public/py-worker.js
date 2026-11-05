/* global loadPyodide */
/* Runs student programs with real Python (Pyodide) in a background worker,
   so a program that never stops can be terminated without freezing the page. */
const params = new URL(self.location.href).searchParams;
const PYODIDE_URL = params.get("u") || "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";

const HARNESS = `
import sys, io, os, json, shutil, tempfile, traceback, linecache, builtins, importlib

_HOME = os.getcwd()

def _clean_error(e, names):
    if isinstance(e, SyntaxError):
        return "".join(traceback.format_exception_only(type(e), e)).rstrip()
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename in names]
    text = "Traceback (most recent call last):\\n" + "".join(traceback.format_list(frames))
    text += "".join(traceback.format_exception_only(type(e), e))
    return text.rstrip()

def run(files_json, entry, stdin_text):
    files = json.loads(files_json)
    lines = str(stdin_text).replace("\\r", "").split("\\n")
    state = {"pos": 0}
    out = io.StringIO()

    def _input(prompt=""):
        if prompt:
            out.write(str(prompt))
        if state["pos"] >= len(lines):
            raise EOFError("EOF when reading a line (your program asked for more input than the test case gives)")
        value = lines[state["pos"]]
        state["pos"] += 1
        return value

    work = tempfile.mkdtemp()
    os.chdir(work)
    for file in files:
        target = os.path.join(work, file["path"])
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w") as f:
            f.write(file["content"])
        linecache.cache[target] = (len(file["content"]), None, [l + "\\n" for l in file["content"].split("\\n")], target)
    names = {os.path.join(work, file["path"]) for file in files}
    code = next(file["content"] for file in files if file["path"] == entry)
    entry_path = os.path.join(work, entry)

    known_modules = set(sys.modules)
    sys.path.insert(0, os.path.dirname(entry_path))
    importlib.invalidate_caches()
    old_out, old_err, old_input = sys.stdout, sys.stderr, builtins.input
    sys.stdout = out
    sys.stderr = out
    builtins.input = _input
    err = ""
    try:
        exec(compile(code, entry_path, "exec"), {"__name__": "__main__", "__file__": entry_path, "input": _input})
    except SystemExit:
        pass
    except BaseException as e:
        err = _clean_error(e, names).replace(work + "/", "")
    finally:
        sys.stdout, sys.stderr, builtins.input = old_out, old_err, old_input
        sys.path.remove(os.path.dirname(entry_path))
        # The student's modules must not carry over into the next run.
        for name in set(sys.modules) - known_modules:
            del sys.modules[name]
        os.chdir(_HOME)
        shutil.rmtree(work, ignore_errors=True)
    return json.dumps({"out": out.getvalue(), "err": err})
`;

let pyodide = null;
const ready = (async () => {
  importScripts(PYODIDE_URL + "pyodide.js");
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  pyodide.runPython(HARNESS);
})();

ready.then(
  () => self.postMessage({ type: "ready" }),
  (e) => self.postMessage({ type: "failed", message: String(e && e.message ? e.message : e) })
);

self.onmessage = async (ev) => {
  const { id, files, entry, input } = ev.data;
  try {
    await ready;
    const run = pyodide.globals.get("run");
    const res = run(JSON.stringify(files), entry, input);
    run.destroy();
    self.postMessage({ type: "result", id, res: JSON.parse(res) });
  } catch (e) {
    self.postMessage({ type: "result", id, res: { out: "", err: "The Python engine stopped unexpectedly: " + (e && e.message ? e.message : e) } });
  }
};
