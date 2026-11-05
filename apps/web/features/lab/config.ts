export const LAB_CONFIG = {
  /**
   * Where the Python engine (Pyodide) is loaded from. If a college network blocks
   * the CDN, copy Pyodide 0.26.4 into public/pyodide/ and set this to "/pyodide/".
   */
  pyodideUrl: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
  /** A program that runs longer than this is stopped with "Time limit exceeded". */
  timeLimitMs: 5000,
} as const

/**
 * Unchanged from the static site, so progress survives a move to the same domain.
 * Students' code and progress are stored by question id: keep ids stable.
 */
export const STORAGE_KEYS = {
  progress: "python-practice-lab:v1",
  layout: "python-practice-lab:layout",
  workspace: "gretlab:workspace:v1",
  editorPrefs: "gretlab:editor-prefs:v1",
} as const
