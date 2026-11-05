"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  outputsMatch,
  overallVerdict,
  type SourceFile,
  type Verdict,
} from "@workspace/judge"
import {
  createContext,
  use,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { api, ApiRequestError } from "@/lib/api/client"
import { useViewer } from "@/features/account/use-viewer"
import {
  addFile,
  currentLanguageId,
  deleteFile,
  editFile,
  openFile,
  readWorkspace,
  renameFile,
  resetWorkspace,
  restoreWorkspace,
  selectLanguage,
  setEntry,
  workspaceStore,
} from "@/features/editor/workspace-store"

import { useLocalStore } from "../lib/local-store"
import { progressStore, saveLayout, saveQuestionStatus } from "../lib/stores"
import type { ProblemDetail, ProblemSummary } from "../types"
import { usePythonEngine } from "./use-python-engine"

export type OutputTab = "cases" | "result"

/** "server" runs in the sandbox; "browser" runs Python locally, for visitors. */
export type ExecutionMode = "loading" | "server" | "browser" | "unavailable"

export interface TestOutcome {
  label: string
  verdict: Verdict
  /** Hidden tests never carry their input, output or expected output. */
  hidden: boolean
  input: string | null
  expected: string | null
  stdout: string | null
  stderr: string | null
  wallMs?: number
  maxRssKb?: number | null
}

export type TestRun =
  | { phase: "running"; message: string }
  | {
      phase: "done"
      /** A Run tries code out. A Submit is graded and recorded. */
      kind: "run" | "submit"
      verdict: Verdict
      compileOutput: string | null
      score: number | null
      maxScore: number | null
      outcomes: TestOutcome[]
      submissionId: string | null
    }

interface SubmissionResponse {
  id: string
  status: "queued" | "running" | "done"
  verdict: Verdict | null
  score: number | null
  maxScore: number | null
  compileOutput: string | null
  results: (TestOutcome & { number: number })[]
}

const POLL_TIMEOUT_MS = 180_000
/** Most programs print something on the first run; ten is more than anyone needs by hand. */
export const MAX_RUN_CASES = 10

interface SubmissionStatus {
  status: SubmissionResponse["status"]
  position: number | null
  nextPollMs: number
}

const BACKOFF_ON_ERROR_MS = 2000

/**
 * Polls the light status endpoint at the pace the server asks for, spread out at random so
 * a whole class doesn't ask in step, and fetches the full result once it's ready.
 */
async function waitForResult(
  id: string,
  onProgress: (position: number | null) => void
): Promise<SubmissionResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let waitMs = 300
  while (Date.now() < deadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, waitMs * (0.8 + Math.random() * 0.4))
    )
    try {
      const status = await api<SubmissionStatus>(`/submissions/${id}/status`)
      if (status.status === "done") {
        return await api<SubmissionResponse>(`/submissions/${id}`)
      }
      onProgress(status.position)
      waitMs = status.nextPollMs
    } catch (error) {
      // A blip shouldn't lose the student's result: the job is still running.
      const retryable = error instanceof ApiRequestError && error.status >= 500
      if (!retryable && error instanceof ApiRequestError) throw error
      waitMs = BACKOFF_ON_ERROR_MS
    }
  }
  throw new ApiRequestError(
    504,
    "timeout",
    "The server is busy and didn't finish in time. Please try again."
  )
}

function queueMessage(position: number | null) {
  if (position === null) return "Running…"
  return position === 0
    ? "Next in the queue…"
    : `Waiting in the queue: ${position} ahead of you…`
}

function useSessionState({
  question,
  detail: givenDetail,
  contestSlug,
  blockedReason,
}: SessionOptions) {
  const queryClient = useQueryClient()
  const { data: viewer } = useViewer()
  const isPlayground = question.id === PLAYGROUND_ID

  const fetched = useQuery({
    queryKey: ["problem", question.id],
    queryFn: () => api<ProblemDetail>(`/problems/${question.id}`),
    enabled: !givenDetail && !isPlayground,
  })
  const detail = givenDetail ?? fetched.data

  const mode: ExecutionMode = !viewer
    ? "loading"
    : viewer.user && viewer.features.serverExecution
      ? "server"
      : viewer.features.browserExecution && !contestSlug
        ? "browser"
        : "unavailable"

  const engine = usePythonEngine(mode === "browser")

  const languages = (viewer?.languages ?? []).filter(
    (language) =>
      (mode !== "browser" || language.id === "python") &&
      (!detail?.allowedLanguages ||
        detail.allowedLanguages.includes(language.id))
  )
  const workspaces = useLocalStore(workspaceStore, (value) => value)
  const languageId = currentLanguageId(workspaces, question.id, languages)
  const language = languages.find((item) => item.id === languageId)
  const workspace = language
    ? readWorkspace(workspaces, question.id, language)
    : null

  // Starts as the samples, once they've loaded. A changed input becomes a custom case.
  const [editedCases, setEditedCases] = useState<string[] | null>(null)
  const cases = editedCases ?? detail?.samples.map(([input]) => input) ?? [""]
  const [activeCase, setActiveCase] = useState(0)
  const [tab, setTab] = useState<OutputTab>("cases")
  const [testRun, setTestRun] = useState<TestRun | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // The session is keyed by question: a run that finishes after the student has
  // moved on must not touch this question's state.
  const isCurrent = useRef(true)
  useEffect(() => {
    isCurrent.current = true
    return () => {
      isCurrent.current = false
    }
  }, [])

  function setCode(value: string) {
    if (!language) return
    editFile(question.id, language, value)
    setSaving(true)
    clearTimeout(saveTimer.current)
    // Not cleared on unmount, so a quick question change still saves.
    saveTimer.current = setTimeout(() => {
      workspaceStore.persist()
      setSaving(false)
    }, 400)
  }

  function openTab(next: OutputTab) {
    setTab(next)
    saveLayout({ outputOpen: true })
  }

  /** Shows a case from the problem text in the panel, adding it if it isn't there. */
  function applySampleInput(value: string) {
    const known = cases.indexOf(value)
    if (known >= 0) {
      setActiveCase(known)
    } else {
      setEditedCases([...cases, value].slice(0, MAX_RUN_CASES))
      setActiveCase(Math.min(cases.length, MAX_RUN_CASES - 1))
    }
    openTab("cases")
  }

  const caseActions = {
    select: setActiveCase,
    edit: (value: string) =>
      setEditedCases(
        cases.map((item, index) => (index === activeCase ? value : item))
      ),
    add: () => {
      setEditedCases([...cases, cases[activeCase] ?? ""])
      setActiveCase(cases.length)
    },
    remove: (index: number) => {
      setEditedCases(cases.filter((_, i) => i !== index))
      setActiveCase(Math.max(0, Math.min(activeCase, cases.length - 2)))
    },
    reset: () => {
      setEditedCases(null)
      setActiveCase(0)
    },
  }

  /** A case the server will check is one whose input still matches a sample. */
  function labelForCases() {
    let custom = 0
    return cases.map((input) => {
      const sample = detail?.samples.findIndex(
        ([known]) => known.trimEnd() === input.trimEnd()
      )
      if (sample !== undefined && sample >= 0) {
        return { label: `Sample ${sample + 1}`, input, sample }
      }
      custom += 1
      return { label: `Custom ${custom}`, input, sample: -1 }
    })
  }

  function markTried() {
    // Contest attempts belong to the contest, not to the practice list.
    if (contestSlug) return
    if (progressStore.get().status[question.id] !== "solved") {
      saveQuestionStatus(question.id, "tried")
    }
  }

  const canRun =
    !busy &&
    !blockedReason &&
    workspace !== null &&
    (mode === "server" || (mode === "browser" && engine.isReady))

  function send(kind: "run" | "submit", files: SourceFile[], entry: string) {
    return api<{ id: string }>("/submissions", {
      body: {
        kind,
        language: language?.id,
        files,
        entry,
        inputs: kind === "run" ? cases : undefined,
        problemSlug: isPlayground ? undefined : question.id,
        contestSlug,
      },
    })
  }

  /** Tries the code on the cases in the panel. Nothing is graded or recorded as a submission. */
  async function runOnce() {
    if (!canRun || !workspace) return
    setBusy(true)
    setRunError(null)
    openTab("result")
    setTestRun({ phase: "running", message: "Running…" })
    try {
      if (mode === "server") {
        const { id } = await send("run", workspace.files, workspace.entry)
        const result = await waitForResult(id, (position) => {
          if (isCurrent.current) {
            setTestRun({ phase: "running", message: queueMessage(position) })
          }
        })
        if (!isCurrent.current) return
        setTestRun(presentResult(result, "run"))
      } else {
        await runInBrowser(workspace.files, workspace.entry)
      }
      if (!isPlayground) markTried()
    } catch (error) {
      if (isCurrent.current) {
        setTestRun(null)
        setRunError(messageOf(error))
      }
    } finally {
      setBusy(false)
    }
  }

  /** Grades the code against every test, and records it in the student's submissions. */
  async function submitForGrading() {
    if (!canRun || !workspace || mode !== "server") return
    setBusy(true)
    setRunError(null)
    openTab("result")
    try {
      setTestRun({ phase: "running", message: "Submitting…" })
      const { id } = await send("submit", workspace.files, workspace.entry)
      const result = await waitForResult(id, (position) => {
        if (isCurrent.current) {
          setTestRun({ phase: "running", message: queueMessage(position) })
        }
      })
      void queryClient.invalidateQueries({ queryKey: ["submissions"] })
      void queryClient.invalidateQueries({ queryKey: ["progress"] })
      void queryClient.invalidateQueries({ queryKey: ["contest-problem"] })
      void queryClient.invalidateQueries({ queryKey: ["contest"] })
      void queryClient.invalidateQueries({ queryKey: ["leaderboard"] })
      if (!isCurrent.current) return
      setTestRun(presentResult(result, "submit"))
      if (result.verdict === "AC" && !contestSlug) {
        saveQuestionStatus(question.id, "solved")
      } else {
        markTried()
      }
    } catch (error) {
      if (isCurrent.current) {
        setTestRun(null)
        setRunError(messageOf(error))
      }
    } finally {
      setBusy(false)
    }
  }

  async function runInBrowser(files: SourceFile[], entry: string) {
    const planned = labelForCases()
    const outcomes: TestOutcome[] = []
    for (const [index, { label, input, sample }] of planned.entries()) {
      setTestRun({
        phase: "running",
        message: `Running case ${index + 1} of ${planned.length}…`,
      })
      const result = await engine.run(files, entry, input)
      const expected = detail?.samples[sample]?.[1] ?? null
      const verdict: Verdict = result.timeout
        ? "TLE"
        : result.err
          ? "RE"
          : expected === null
            ? "OK"
            : outputsMatch(result.out, expected)
              ? "AC"
              : "WA"
      outcomes.push({
        label,
        verdict,
        hidden: false,
        input,
        expected,
        stdout: result.out,
        stderr: result.err,
      })
    }
    if (!isCurrent.current) return
    setTestRun({
      phase: "done",
      kind: "run",
      verdict: overallVerdict(outcomes),
      compileOutput: null,
      score: null,
      maxScore: null,
      outcomes,
      submissionId: null,
    })
  }

  const files = {
    open: (path: string) => language && openFile(question.id, language, path),
    add: (path: string) => language && addFile(question.id, language, path),
    rename: (from: string, to: string) =>
      language && renameFile(question.id, language, from, to),
    remove: (path: string) =>
      language && deleteFile(question.id, language, path),
    setEntry: (path: string) =>
      language && setEntry(question.id, language, path),
    reset: () => language && resetWorkspace(question.id, language),
    /** Brings an earlier submission's code back into the editor. */
    restore: (saved: SourceFile[], entry: string) =>
      language && restoreWorkspace(question.id, language, saved, entry),
  }

  return {
    question,
    detail,
    contestSlug,
    isPlayground,
    mode,
    viewer,
    languages,
    language,
    selectLanguage: (id: string) => {
      const next = languages.find((item) => item.id === id)
      if (next) selectLanguage(question.id, next)
    },
    workspace,
    files,
    setCode,
    saving,
    cases,
    activeCase,
    caseActions,
    labelForCases,
    applySampleInput,
    tab,
    openTab,
    testRun,
    runError,
    blockedReason,
    busy,
    canRun,
    runOnce,
    submitForGrading,
  }
}

function messageOf(error: unknown) {
  return error instanceof ApiRequestError
    ? error.message
    : "Something went wrong. Please try again."
}

function presentResult(
  result: SubmissionResponse,
  kind: "run" | "submit"
): TestRun {
  return {
    phase: "done",
    kind,
    verdict: result.verdict ?? "SE",
    compileOutput: result.compileOutput,
    score: result.score,
    maxScore: result.maxScore,
    submissionId: kind === "submit" ? result.id : null,
    outcomes: result.results,
  }
}

export const PLAYGROUND_ID = "playground"

interface SessionOptions {
  question: ProblemSummary
  detail?: ProblemDetail
  contestSlug?: string
  /** Why code can't run here right now, such as a contest that needs registering for. */
  blockedReason?: ReactNode
}

type QuestionSession = ReturnType<typeof useSessionState>

const SessionContext = createContext<QuestionSession | null>(null)

/** Everything tied to the open question. Key it by question id to reset on change. */
export function QuestionSessionProvider({
  children,
  ...options
}: SessionOptions & { children: ReactNode }) {
  const session = useSessionState(options)
  return <SessionContext value={session}>{children}</SessionContext>
}

export function useQuestionSession() {
  const session = use(SessionContext)
  if (!session) {
    throw new Error(
      "useQuestionSession must be used inside QuestionSessionProvider"
    )
  }
  return session
}
