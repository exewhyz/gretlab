/**
 * LTI 1.3 against a fake LMS run here (its own keys, token and grades endpoints): login
 * initiation, signed launches (and every way one is refused), accounts, classes and roles,
 * deep linking (Gretlab's signature checked like an LMS would), sending grades, the pages.
 * The server needs LTI_ALLOW_HTTP=true (the fake LMS is http) and GITHUB_LOOKUP=off.
 *   node e2e/lti.mjs [base-url] [screenshot-dir]
 */
import { createPublicKey, createSign, createVerify, generateKeyPairSync, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createServer } from "node:http"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
const LMS_PORT = 3199
const LMS = `http://localhost:${LMS_PORT}`
mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? "  -- " + String(detail).slice(0, 200) : ""}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()

// ---------- the fake LMS
const { privateKey: lmsKey, publicKey: lmsPub } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const lmsJwk = { ...lmsPub.export({ format: "jwk" }), kid: "lms-key-1", alg: "RS256", use: "sig" }
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url")
const sign = (payload, key = lmsKey, kid = "lms-key-1") => {
  const head = b64({ alg: "RS256", typ: "JWT", kid })
  const body = b64(payload)
  return `${head}.${body}.${createSign("RSA-SHA256").update(`${head}.${body}`).sign(key).toString("base64url")}`
}
const verifyWithTool = async (jwt) => {
  const [h, p, s] = jwt.split(".")
  const header = JSON.parse(Buffer.from(h, "base64url"))
  const { keys } = await (await fetch(`${BASE}/api/v1/lti/jwks`)).json()
  const jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) return null
  const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url"))
  return ok ? JSON.parse(Buffer.from(p, "base64url")) : null
}
const lms = { tokenRequests: [], scores: [], deepLinkReturns: [] }
const readBody = (req) => new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)) })
const server = createServer(async (req, res) => {
  const body = await readBody(req)
  if (req.url === "/jwks") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: [lmsJwk] }))
  if (req.url === "/token" && req.method === "POST") {
    const form = new URLSearchParams(body)
    const claims = await verifyWithTool(form.get("client_assertion"))
    lms.tokenRequests.push({ form: Object.fromEntries(form), claims })
    if (!claims) return res.writeHead(401).end("bad assertion")
    return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: "tok-123", token_type: "Bearer", expires_in: 3600 }))
  }
  if (req.url?.startsWith("/lineitems/") && req.url.includes("/scores") && req.method === "POST") {
    lms.scores.push({ url: req.url, auth: req.headers.authorization, type: req.headers["content-type"], body: JSON.parse(body) })
    return res.writeHead(req.headers.authorization === "Bearer tok-123" ? 200 : 401).end()
  }
  if (req.url === "/dl-return" && req.method === "POST") {
    lms.deepLinkReturns.push(new URLSearchParams(body).get("JWT"))
    return res.writeHead(200, { "content-type": "text/html" }).end("<p id=done>Added to the course</p>")
  }
  res.writeHead(404).end()
})
await new Promise((r) => server.listen(LMS_PORT, r))

// ---------- Gretlab side
const cleanup = () => {
  psql(`delete from assignments where title like 'lti %'`)
  psql(`delete from organizations where slug = 'ltitest'`)
  psql(`delete from users where email like 'lti-%'`)
}
cleanup()
psql(`delete from lti_keys`)
for (const h of ["lti-admin"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h}','student','${h}')`)
const cookieFor = async (email) => `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
const client = (cookie) => async (path, { method, body } = {}) => {
  const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const admin = client(await cookieFor("admin@example.com"))
await admin("/admin/organizations", { body: { name: "LTI College", slug: "ltitest", type: "college", ownerEmail: "lti-admin@example.com" } })
const O = "/orgs/ltitest"
const orgAdmin = client(await cookieFor("lti-admin@example.com"))
const lab = (await orgAdmin(`${O}/groups`, { body: { name: "lti Lab" } })).json
const registration = { name: "Fake Moodle", issuer: LMS, clientId: "gl-client", deploymentIds: ["dep-1"], authUrl: `${LMS}/auth`, tokenUrl: `${LMS}/token`, jwksUrl: `${LMS}/jwks` }
check("LMS addresses must be web addresses", (await orgAdmin(`${O}/lti`, { body: { ...registration, jwksUrl: "ftp://x" } })).json?.error?.code === "bad_url")
const platform = await orgAdmin(`${O}/lti`, { body: registration })
check("an admin connects the LMS", platform.status === 200, JSON.stringify(platform.json).slice(0, 150))
check("the same registration twice is refused", (await orgAdmin(`${O}/lti`, { body: registration })).json?.error?.code === "duplicate")
const settings = (await orgAdmin(`${O}/lti`)).json
check("the addresses to give the LMS", settings.tool.loginUrl.endsWith("/api/v1/lti/login") && settings.tool.jwksUrl.endsWith("/api/v1/lti/jwks"))

// ---------- launching
const now = () => Math.floor(Date.now() / 1000)
const LIS = "http://purl.imsglobal.org/vocab/lis/v2/membership#"
const C = "https://purl.imsglobal.org/spec/lti/claim/"
async function launch({ sub, email, name, roles = [`${LIS}Learner`], context = { id: "course-101", title: "CS101 Python" }, link = { id: "rl-1", title: "Week 1" }, custom, ags, type = "LtiResourceLinkRequest", dl, change = {}, signer, reuseState, skipLogin }) {
  const login = await fetch(`${BASE}/api/v1/lti/login?iss=${encodeURIComponent(LMS)}&login_hint=${sub}&client_id=gl-client&target_link_uri=${encodeURIComponent(BASE + "/api/v1/lti/launch")}`, { redirect: "manual" })
  if (login.status !== 302) return { status: login.status, html: await login.text() }
  const to = new URL(login.headers.get("location"))
  const state = reuseState ?? to.searchParams.get("state")
  const stateCookie = login.headers.get("set-cookie")?.split(";")[0] ?? ""
  const claims = {
    iss: LMS, aud: "gl-client", sub, iat: now(), exp: now() + 300, nonce: to.searchParams.get("nonce"),
    ...(email ? { email } : {}), ...(name ? { name } : {}),
    [`${C}version`]: "1.3.0", [`${C}deployment_id`]: "dep-1", [`${C}message_type`]: type, [`${C}roles`]: roles,
    [`${C}context`]: context, [`${C}target_link_uri`]: `${BASE}/api/v1/lti/launch`,
    ...(type === "LtiResourceLinkRequest" ? { [`${C}resource_link`]: link } : {}),
    ...(custom ? { [`${C}custom`]: custom } : {}),
    ...(ags ? { "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": ags } : {}),
    ...(dl ? { "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings": dl } : {}),
    ...change,
  }
  const res = await fetch(to.searchParams.get("redirect_uri"), {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: stateCookie, origin: LMS },
    body: new URLSearchParams({ id_token: signer ? signer(claims) : sign(claims), state }),
  })
  const session = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("next-auth.session-token="))?.split(";")[0]
  return { status: res.status, location: res.headers.get("location"), session, html: res.status >= 400 ? await res.text() : "", state, to }
}

check("an unknown LMS is refused at login", (await fetch(`${BASE}/api/v1/lti/login?iss=https://evil.example&login_hint=x`, { redirect: "manual" })).status === 400)
const first = await launch({ sub: "u-ann", email: "lti-ann@example.com", name: "Ann Learner" })
check("login redirects to the LMS with state and nonce, launch signs in", first.status === 303 && !!first.session && first.to.searchParams.get("response_mode") === "form_post" && first.to.searchParams.get("redirect_uri").endsWith("/api/v1/lti/launch"), JSON.stringify({ s: first.status, l: first.location, h: first.html.slice(0, 200) }))
check("an unlinked course says so", new URL(first.location).pathname === "/lti/unlinked")
const ann = client(first.session)
check("members without settings permission can't connect an LMS", [403, 404].includes((await client(first.session)(`${O}/lti`, { body: { ...registration, clientId: "x" } })).status))
check("the session is real: they're signed in", (await ann("/me")).json?.user?.email === "lti-ann@example.com")
check("a new account, a member of the college", psql(`select m.status || ' ' || m.joined_via from org_members m join users u on u.id = m.user_id where u.email='lti-ann@example.com'`) === "active lti")
const course = (await orgAdmin(`${O}/lti`)).json.platforms[0].contexts[0]
check("the course shows up for the admin to link", course?.title === "CS101 Python")
await orgAdmin(`${O}/lti/contexts/${course.id}`, { method: "PUT", body: { groupId: lab.id } })
const second = await launch({ sub: "u-ann", email: "lti-ann@example.com" })
check("once linked: placed in the class and sent to it", new URL(second.location).pathname === `${O}/classes/${lab.id}` && psql(`select count(*) from group_members gm join users u on u.id = gm.user_id where u.email='lti-ann@example.com' and gm.group_id='${lab.id}'`) === "1")
check("the LMS id stays linked even if the email changes there", (await launch({ sub: "u-ann", email: "changed@lms.example" })).status === 303 && psql(`select count(*) from users where email='changed@lms.example'`) === "0")

// ---------- refusals
const bad = async (name, opts, code) => {
  const r = await launch({ sub: "u-ann", email: "lti-ann@example.com", ...opts })
  check(name, r.status === 400 && (!code || r.html.includes(code)), `${r.status} ${r.html.replace(/<[^>]+>/g, " ").slice(0, 160)}`)
}
const { privateKey: otherKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
await bad("a forged signature", { signer: (c) => sign(c, otherKey) }, "signature")
await bad("a wrong nonce", { change: { nonce: "nope" } }, "doesn")
await bad("another tool's launch", { change: { aud: "someone-else" } })
await bad("an unregistered deployment", { change: { [`${C}deployment_id`]: "dep-9" } }, "deployment")
await bad("an expired launch", { change: { exp: now() - 600, iat: now() - 900 } }, "expired")
await bad("not LTI 1.3", { change: { [`${C}version`]: "1.1" } })
const once = await launch({ sub: "u-ann", email: "lti-ann@example.com" })
await bad("a state used twice", { reuseState: once.state })
const noEmail = await launch({ sub: "u-new", name: "No Mail" })
check("a new person without an email is refused", noEmail.status === 400 && noEmail.html.includes("email"))

// ---------- a teacher, an assignment link, grades
const ted = await launch({ sub: "u-ted", email: "lti-ted@example.com", name: "Ted Teacher", roles: [`${LIS}Instructor`] })
check("an instructor gets the Teacher role for the class", psql(`select count(*) from role_assignments ra join org_roles r on r.id = ra.role_id join users u on u.id = ra.user_id where u.email='lti-ted@example.com' and r.system_key='teacher' and ra.group_id='${lab.id}'`) === "1" && ted.status === 303)
const tedApi = client(ted.session)
const assignment = (await orgAdmin(`${O}/assignments`, { body: { title: "lti Project", slug: "lti-project", description: "", opensAt: new Date(Date.now() - 3600e3).toISOString(), dueAt: new Date(Date.now() + 86400e3).toISOString(), allowLate: false, latePenaltyPercent: 0, published: true, holdFeedback: false, exam: null, audience: [[lab.id]], problems: [], questions: [], projects: [{ title: "Calculator", instructions: "", points: 10 }] } })).json
const opened = await launch({ sub: "u-ann", email: "lti-ann@example.com", link: { id: "rl-project", title: "Project" }, custom: { assignment: "lti-project" }, ags: { lineitem: `${LMS}/lineitems/1`, scope: ["https://purl.imsglobal.org/spec/lti-ags/scope/score"] } })
check("a link to an assignment opens it", new URL(opened.location).pathname === "/assignments/lti-project")
check("and remembers its gradebook column", psql(`select line_item_url from lti_links where resource_link_id='rl-project'`) === `${LMS}/lineitems/1`)
const pid = (await ann("/assignments/lti-project")).json.projects[0].id
await ann(`/assignments/lti-project/projects/${pid}`, { body: { url: "https://github.com/ann/calc/commit/abcdef1", note: "" } })
await orgAdmin(`${O}/assignments/${assignment.id}/projects`, { method: "PUT", body: { student: "lti-ann@example.com", projectId: pid, mark: 7, feedback: "" } })
// A classmate who signs in with Google, never through the LMS.
psql(`insert into users(email,name,role,handle) values ('lti-gina@example.com','Gina','student','lti-gina')`)
psql(`insert into org_members(org_id,user_id,status,joined_via) select o.id, u.id, 'active', 'created' from organizations o, users u where o.slug='ltitest' and u.email='lti-gina@example.com'`)
psql(`insert into group_members(group_id,user_id) select '${lab.id}', id from users where email='lti-gina@example.com'`)
check("students can't send grades", [403, 404].includes((await ann(`${O}/assignments/${assignment.id}/lti-grades`, { body: {} })).status))
check("the gradebook knows where grades go", (await tedApi(`${O}/assignments/${assignment.id}/lti-grades`)).json?.targets?.[0]?.lms === "Fake Moodle")
const sent = await tedApi(`${O}/assignments/${assignment.id}/lti-grades`, { body: {} })
const score = lms.scores.at(-1)
check("grades go to the LMS", sent.json?.sent === 1 && score?.body.userId === "u-ann" && score.body.scoreGiven === 7 && score.body.scoreMaximum === 10 && score.url === "/lineitems/1/scores", JSON.stringify(sent.json))
check("as score messages, with a token", score?.type === "application/vnd.ims.lis.v1.score+json" && score.auth === "Bearer tok-123" && score.body.gradingProgress === "FullyGraded")
const assertion = lms.tokenRequests.at(-1)
check("the token was asked for with a signed assertion the LMS can check", assertion?.claims?.iss === "gl-client" && assertion.claims.aud === `${LMS}/token` && assertion.form.scope.includes("lti-ags/scope/score"))
check("people who never came from the LMS are skipped", sent.json?.skipped >= 1)

// ---------- deep linking
const learnerDl = await launch({ sub: "u-ann", email: "lti-ann@example.com", type: "LtiDeepLinkingRequest", dl: { deep_link_return_url: `${LMS}/dl-return`, data: "abc" } })
check("learners can't add content", learnerDl.status === 403)
const dl = await launch({ sub: "u-ted", email: "lti-ted@example.com", roles: [`${LIS}Instructor`], type: "LtiDeepLinkingRequest", dl: { deep_link_return_url: `${LMS}/dl-return`, data: "abc" } })
check("a teacher's deep linking request opens the picker", /^\/lti\/pick\/[0-9a-f-]{36}$/.test(new URL(dl.location).pathname))
const pickId = new URL(dl.location).pathname.split("/").pop()
check("only for them", (await ann(`/lti/deep-link/${pickId}`)).status === 404)
const choices = (await tedApi(`/lti/deep-link/${pickId}`)).json
check("it lists the college's assignments", choices?.assignments?.some((a) => a.slug === "lti-project"))
const answer = (await tedApi(`/lti/deep-link/${pickId}`, { body: { assignmentId: assignment.id } })).json
const reply = answer?.jwt ? await verifyWithTool(answer.jwt) : null
const item = reply?.["https://purl.imsglobal.org/spec/lti-dl/claim/content_items"]?.[0]
check("the answer is signed by Gretlab and checks out", reply?.iss === "gl-client" && reply.aud === LMS && reply[`${C}message_type`] === "LtiDeepLinkingResponse" && reply[`${C}deployment_id`] === "dep-1" && reply["https://purl.imsglobal.org/spec/lti-dl/claim/data"] === "abc")
check("with the assignment as a link and a gradebook column", item?.type === "ltiResourceLink" && item.custom.assignment === "lti-project" && item.lineItem.scoreMaximum === 10 && answer.returnUrl === `${LMS}/dl-return`)
check("a choice is used once", (await tedApi(`/lti/deep-link/${pickId}`, { body: { assignmentId: assignment.id } })).status === 404)

// ---------- the pages
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
await page.context().addCookies([{ name: "next-auth.session-token", value: (await cookieFor("lti-admin@example.com")).split("=")[1], url: BASE }])
await page.goto(`${BASE}${O}/manage/lms`)
await page.getByTestId("lti-platform").waitFor({ timeout: 30000 })
check("the LMS page: addresses, the LMS and its courses", (await page.getByTestId("lti-course").count()) === 1 && (await page.getByLabel("Login (initiate login) URL").inputValue()).endsWith("/api/v1/lti/login"))
await page.screenshot({ path: SHOTS + "lti-settings.png", fullPage: true })
const dl2 = await launch({ sub: "u-ted", email: "lti-ted@example.com", roles: [`${LIS}Instructor`], type: "LtiDeepLinkingRequest", dl: { deep_link_return_url: `${LMS}/dl-return` } })
const tp = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage()
await tp.context().addCookies([{ name: "next-auth.session-token", value: dl2.session.split("=")[1], url: BASE }])
await tp.goto(dl2.location)
await tp.getByRole("button", { name: "Add lti Project" }).click({ timeout: 30000 })
await tp.waitForURL(`${LMS}/dl-return`, { timeout: 15000 })
check("the picker posts the signed answer to the LMS", lms.deepLinkReturns.length === 1 && (await verifyWithTool(lms.deepLinkReturns[0]))?.[`${C}message_type`] === "LtiDeepLinkingResponse")
await browser.close()
server.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
