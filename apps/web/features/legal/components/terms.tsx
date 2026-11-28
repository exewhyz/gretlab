import Link from "next/link"

import type { LegalFacts } from "../server"
import { Contact, LINK, LegalPage, List, type LegalSection } from "./legal-page"

/*
 * The terms of use. Keep them true of the product (what the judge, exams and certificates
 * actually do) and change LEGAL_UPDATED (../server.ts) with any edit.
 */

export function Terms({ facts }: { facts: LegalFacts }) {
  const { site, operator, jurisdiction } = facts

  const sections: LegalSection[] = [
    {
      id: "agreement",
      title: "Using these terms",
      body: (
        <>
          <p>
            These terms are an agreement between you and{" "}
            {operator === site ? site : `${operator}, which runs ${site}`} (&quot;we&quot;,
            &quot;us&quot;). By creating an account or using {site}, you
            accept them and our{" "}
            <Link href="/privacy" className={LINK}>
              privacy policy
            </Link>
            . If you don&apos;t agree, please don&apos;t use {site}.
          </p>
          <p>
            If you set up or manage an organization on {site}, you accept these terms for
            that organization too, and confirm you are allowed to. An organization may also
            have a separate agreement with us; where it does, that agreement wins where the
            two differ.
          </p>
        </>
      ),
    },
    {
      id: "accounts",
      title: "Your account",
      body: (
        <List>
          <li>Give your real name and an email address you use. One person, one account: don&apos;t share it or use someone else&apos;s.</li>
          <li>Keep your password and two-factor codes private. You&apos;re responsible for what happens under your account; tell us at once if you think someone else has used it.</li>
          <li>If you&apos;re under 18, use {site} through your school or with a parent or guardian&apos;s permission.</li>
          <li>Your organization may require two-factor sign-in, and may add you to classes, or remove you, as its own rules allow.</li>
        </List>
      ),
    },
    {
      id: "organizations",
      title: "Organizations",
      body: (
        <>
          <p>Schools, colleges, companies and communities that run on {site} agree that:</p>
          <List>
            <li>they have the right to add their members and to record what they record about them (attendance, marks, records, applications), including any consent needed from students and parents;</li>
            <li>they are responsible for their content, settings and roles, and for the systems they connect, such as a learning management system, API keys and webhooks;</li>
            <li>they will answer their members&apos; questions about the records they keep, and pass on requests that need us.</li>
          </List>
          <p>
            Each organization sees only its own data. The kind of organization (school,
            college and so on) is chosen when it is created and can&apos;t be changed later.
          </p>
        </>
      ),
    },
    {
      id: "plans",
      title: "Plans and payments",
      body: (
        <>
          <p>
            Organizations may use {site} on a free plan or pay for one: the features, students
            and staff they choose, at the prices shown when they choose them.
          </p>
          <List>
            <li>A plan is paid for a month, a semester (six months) or a year, in advance, in Indian rupees, through our payment provider. Prices are before GST, which is added where it applies and shown on the invoice.</li>
            <li>A period starts on the day it&apos;s paid. Adding features, students or staff during a period costs only the days left in it; a smaller plan starts at the next period. Whether you pay by the month, semester or year can change when you renew.</li>
            <li>Payments aren&apos;t refunded, in whole or in part, including when a plan is made smaller or the organization stops using {site} during a period.</li>
            <li>Before a period ends, whoever manages billing is reminded to pay for the next one. If it isn&apos;t paid, the plan is past due for 7 days and then paused.</li>
            <li>When an organization goes past the students or staff its plan allows, it has 30 days to add more before adding people is paused.</li>
            <li>A paused plan stops new members and new staff roles from being added. Nothing already there is deleted or hidden: work in progress, records and grades stay as they are, and paying restores everything at once.</li>
            <li>Organizations above 10,000 students, and arrangements agreed with us in writing, are priced separately; what we agreed applies.</li>
            <li>We may change prices for future periods; a period already paid for keeps its price.</li>
            <li>A referral code or coupon gives the discount it states for the payments it states, worked out when you pay. A code can be paused, expire or run out.</li>
            <li>Fees an institution collects in {site} (Fees module) are between the institution and its students: online payments go to the institution&apos;s own Razorpay account, never through us, and the institution sets its fees, concessions, fines and refunds. We provide the records and receipts; we aren&apos;t a party to those payments.</li>
            <li>A university and its affiliated colleges are separate organizations, each on its own plan. An affiliation lets the university see the academics of the college&apos;s students as the privacy policy says; either side may end it at any time, and the university&apos;s access ends with it.</li>
            <li>Refer and earn: when an organization you referred pays for a plan, you earn the share shown on your Refer and earn page of each payment (before GST) for the months shown there, counted from its first payment. Your own organization, or one you're a member of, doesn't count. Earnings are paid out by us by hand (UPI or bank transfer), and we may cancel earnings from payments that are refunded, reversed or made to abuse the scheme.</li>
          </List>
        </>
      ),
    },
    {
      id: "content",
      title: "Your content",
      body: (
        <>
          <p>
            The code, answers, posts and other work you put on {site} remain yours. You give
            us permission to store, copy, run, judge and display it, only as needed to run
            {" "}{site}: for example, to grade a submission, show it to the teachers of your
            class, or keep your working copy. That permission ends when the content is
            deleted, except for copies an organization keeps as its records, such as graded
            work.
          </p>
          <p>
            Problems, questions, courses and other material in the library belong to us or
            to the people and organizations who wrote them. Use them to learn and to teach on
            {" "}{site}; don&apos;t copy them in bulk or republish them elsewhere without
            permission.
          </p>
        </>
      ),
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      body: (
        <>
          <p>Don&apos;t use {site} to:</p>
          <List>
            <li>break out of, attack or overload the code sandbox or the service, or submit code meant to (mining, flooding, probing other systems);</li>
            <li>reach data, accounts or pages you aren&apos;t allowed to, or get around the exam lock, network limits or other controls;</li>
            <li>cheat: share or copy exam and assignment answers when that isn&apos;t allowed, sit an exam for someone else, or use another person&apos;s account;</li>
            <li>post anything illegal, hateful, harassing, sexually explicit or that invades someone&apos;s privacy, in discussions, reviews, problems or anywhere else;</li>
            <li>upload work you don&apos;t have the right to share;</li>
            <li>scrape or download the site in bulk, beyond what its robots.txt allows.</li>
          </List>
          <p>
            Found a security problem? Tell us privately (see{" "}
            <a href="#contact" className={LINK}>
              Contact
            </a>
            ) and give us time to fix it before telling anyone else. Good-faith reports
            are welcome.
          </p>
        </>
      ),
    },
    {
      id: "assessments",
      title: "Grades, exams and contests",
      body: (
        <List>
          <li>Runs try your code on sample cases and aren&apos;t graded. Submissions are judged automatically against every test, and that result is what counts.</li>
          <li>Teachers decide their assignments&apos; rules (due times, late penalties, rubrics) and may change or override a mark. Questions about a grade go to your teacher or organization.</li>
          <li>A submission that fails because of our system (&quot;System error&quot;) is judged again automatically, keeping the time you submitted it.</li>
          <li>During a lab exam the site locks to the exam, and leaving the tab or full screen and pasting are recorded for your teacher. These records and code similarity checks are signals for a teacher to look into, not proof of cheating on their own.</li>
          <li>Contest results and leaderboards are computed from submissions; we may remove results gained by breaking these terms.</li>
        </List>
      ),
    },
    {
      id: "certificates",
      title: "Certificates",
      body: (
        <p>
          Certificates are issued by organizations, which are responsible for them. Each has
          a public page that anyone with its code can open to check it. An organization may
          revoke a certificate; the page then says so.
        </p>
      ),
    },
    {
      id: "third-parties",
      title: "Ads and other services",
      body: (
        <p>
          Public practice pages show ads from Google. Links to other services, such as
          GitHub, Google or your learning management system, are governed by their own
          terms; we aren&apos;t responsible for them.
        </p>
      ),
    },
    {
      id: "service",
      title: "Changes and availability",
      body: (
        <p>
          We keep improving {site}, so features may change, and we may pause the service
          for maintenance. We try to keep it running and your work safe, but we can&apos;t
          promise it will always be available or free of errors. Nothing is charged to you
          without your agreement; plans for organizations are described under{" "}
          <a href="#plans" className={LINK}>
            Plans and payments
          </a>
          .
        </p>
      ),
    },
    {
      id: "ending",
      title: "Ending your use",
      body: (
        <p>
          You can stop using {site} at any time and ask us by email to delete your account
          (see the{" "}
          <Link href="/privacy#rights" className={LINK}>
            privacy policy
          </Link>
          ). We may suspend or close an account, or an organization, that breaks these terms
          or puts others at risk; where we reasonably can, we will tell you why first. An
          organization can remove you from it; your personal account stays.
        </p>
      ),
    },
    {
      id: "liability",
      title: "Our responsibility",
      body: (
        <>
          <p>
            {site} is provided &quot;as is&quot;. As far as the law allows, we aren&apos;t
            responsible for indirect losses, such as lost opportunities or profits, arising
            from your use of {site}, and our total responsibility to you is limited to the
            amount you paid us, if any, in the twelve months before the claim.
          </p>
          <p>
            Nothing in these terms limits rights you have by law that can&apos;t be limited,
            or our responsibility for harm caused by our fraud or gross negligence.
          </p>
          <p>
            If you misuse {site} and someone makes a claim against us because of it, you
            agree to cover the reasonable costs it causes us.
          </p>
        </>
      ),
    },
    {
      id: "law",
      title: "Law and disputes",
      body: (
        <p>
          These terms are governed by the laws of {jurisdiction}, and the courts of{" "}
          {jurisdiction} decide disputes about them. Before going to court, please write to
          us: most problems are resolved faster that way.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to these terms",
      body: (
        <p>
          When we change these terms, we update the date at the top. If a change matters,
          we will tell you by email or on the site before it takes effect. Using {site}
          after that means you accept the new terms.
        </p>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: (
        <>
          <p>Questions about these terms, and reports of misuse or security problems:</p>
          <Contact facts={facts} />
        </>
      ),
    },
  ]

  return (
    <LegalPage
      facts={facts}
      current="/terms"
      title="Terms of use"
      intro={
        <p className="text-body-md">
          The rules for using {site}: what you can expect from us, and what we and the
          organizations on {site} expect from you.
        </p>
      }
      summary={[
        <>Your code and work stay yours; we use them only to run {site}.</>,
        <>Keep your account to yourself and don&apos;t attack the sandbox or other people&apos;s data.</>,
        <>Your teacher or organization sets and answers for grades, exams and certificates.</>,
        <>Exam records and similarity checks are signals for teachers, not proof.</>,
        <>You can leave at any time and ask us to delete your account.</>,
      ]}
      sections={sections}
    />
  )
}
