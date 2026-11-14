/*
 * Exams and report cards on the server, one file per job; this index keeps the old import
 * path. results-core (who may do what, schemas, shared lookups), exam-setup (terms, exams,
 * papers, the grading scale), marks (marks and remarks), report-cards (class results,
 * publishing, report and grade cards).
 */
/*
 * Exams and report cards (a module). An exam belongs to an academic year; its papers are
 * one per subject per class (a section), each with full and pass marks; marks are per
 * student per paper. Who sits a paper comes from the year's enrolments (Student records),
 * not from today's classes, so last year's results stay right after promotion.
 *
 * Who may do what:
 *   - "Set up exams" (exams.setup, organization-wide): exams, papers, the grading scale,
 *     publishing.
 *   - Entering marks: the paper's subject teacher (Subjects module), or "Enter marks"
 *     (exams.marks) covering the class.
 *   - "See results" (exams.view, the Teacher role has it) covering the class.
 *   - Students and their parents see their own report card, published exams only.
 * Marks are locked while an exam is published. Rules in packages/judge/src/results.ts.
 */

export {
  addExam,
  addPapers,
  addTerm,
  deleteExam,
  deletePaper,
  deleteTerm,
  examSettings,
  getExam,
  listExams,
  saveScale,
  updateExam,
  updatePaper,
  updateTerm,
} from "./exam-setup"
export {
  paperSheet,
  papersToMark,
  remarksSheet,
  saveMarks,
  saveRemarks,
} from "./marks"
export {
  classReportCards,
  examResults,
  publishedFor,
  reportCard,
  setPublished,
} from "./report-cards"
export type { CreditCardData, ReportCardData } from "./report-cards"
export {
  examPatchSchema,
  examSchema,
  marksSchema,
  paperPatchSchema,
  papersSchema,
  publishSchema,
  remarksSchema,
  scaleSchema,
  termPatchSchema,
  termSchema,
} from "./results-core"
