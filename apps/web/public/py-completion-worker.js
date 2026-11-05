/* Python completions from Jedi, running in the browser: nothing is sent to a server. */
/* global loadPyodide */
const PYODIDE_URL = new URL(self.location.href).searchParams.get("u");

const HARNESS = `
import json, os, shutil
import jedi

ROOT = "/workspace"

def complete(files_json, path, line, column):
    shutil.rmtree(ROOT, ignore_errors=True)
    os.makedirs(ROOT)
    for file in json.loads(files_json):
        target = os.path.join(ROOT, file["path"])
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w") as f:
            f.write(file["content"])
    target = os.path.join(ROOT, path)
    with open(target) as f:
        code = f.read()
    script = jedi.Script(code=code, path=target, project=jedi.Project(ROOT))
    return json.dumps([
        {"name": c.name, "type": c.type, "insert": c.name}
        for c in script.complete(line, column)[:200]
    ])
`;

const ready = (async () => {
  importScripts(PYODIDE_URL + "pyodide.js");
  const pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  await pyodide.loadPackage(["jedi", "parso"]);
  pyodide.runPython(HARNESS);
  return pyodide.globals.get("complete");
})();

self.onmessage = async (event) => {
  const { id, files, path, line, column } = event.data;
  try {
    const complete = await ready;
    const items = JSON.parse(complete(JSON.stringify(files), path, line, column));
    self.postMessage({ id, items });
  } catch (error) {
    self.postMessage({ id, items: [], error: String(error) });
  }
};
