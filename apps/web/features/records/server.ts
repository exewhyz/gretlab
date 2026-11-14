/*
 * Student records on the server, one file per job; this index keeps the old import path.
 * records-core (checks, schemas, placing students), years (academic years and class
 * teachers), students-server (records, admission numbers, import, ID cards),
 * promotion-server, transfer-certificates.
 */
/*
 * Student records (a module): academic years, each student's record (admission number,
 * gender, and phone, date of birth and address sealed), and an enrolment per student per
 * year placing them in a group with a roll number and a status. The current year's
 * active enrolments are the students' places (group_members), so registers, timetables,
 * parents and the rest follow them: making another year current, or placing, moving or
 * withdrawing a student, rewrites their places (place / syncPlaces). A student may never
 * sign in: their account then has an address on .invalid (noLoginEmail), which Google
 * can't sign in and the outbox never mails. Rules in packages/judge/src/records.ts.
 */

export { promote, promoteSchema, promotionPlan } from "./promotion-server"
export { statusSchema, studentSchema, yearSchema } from "./records-core"
export {
  addStudent,
  admissionFree,
  createInTx,
  getStudent,
  idCardData,
  importSchema,
  importStudents,
  listStudents,
  nextNumber,
  recordEveryone,
  setStatus,
  suggestAdmissionNo,
  unrecordedCount,
  updateStudent,
} from "./students-server"
export {
  issueTransferCertificate,
  tcSchema,
  transferCertificate,
  transferCertificatesOf,
} from "./transfer-certificates"
export type { TcDetails } from "./transfer-certificates"
export {
  addYear,
  classTeachersOf,
  classTeachersSchema,
  deleteYear,
  listYears,
  setClassTeachers,
  updateYear,
} from "./years"
