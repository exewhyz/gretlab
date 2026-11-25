import Link from "next/link"

import type { LegalFacts } from "../server"
import { Contact, Item, LINK, LegalPage, List, type LegalSection } from "./legal-page"

/*
 * The privacy policy. Every statement here must be true of the code: when a feature changes
 * what it keeps or who sees it, change this text and LEGAL_UPDATED (../server.ts) with it.
 * Written plainly, for students and parents as much as for schools.
 */

export function PrivacyPolicy({ facts }: { facts: LegalFacts }) {
  const { site, operator } = facts
  const we = operator === site ? site : `${operator}, which runs ${site}`

  const sections: LegalSection[] = [
    {
      id: "who",
      title: "Who is responsible for your data",
      body: (
        <>
          <p>
            {operator === site ? (
              <>This policy is {site}&apos;s (&quot;we&quot;, &quot;us&quot;).</>
            ) : (
              <>
                {site} is run by {operator} (&quot;we&quot;, &quot;us&quot;).
              </>
            )}{" "}
            There are two situations, and they matter for who you ask about your data:
          </p>
          <List>
            <Item term="Your own account and practice">
              When you sign up yourself, practise problems, enter public contests or use the
              playground, we decide how that data is used, and this policy is our promise
              about it.
            </Item>
            <Item term="Your school, college, company or community">
              When an organization uses {site} (for classes, attendance, assignments, exams,
              report cards, admissions and so on), the organization decides what it records
              about its members and why. We store and process that data on its behalf and
              under its instructions. Questions about those records, such as a mark, an
              attendance entry or a student record, go to the organization first; we will
              help it answer.
            </Item>
          </List>
        </>
      ),
    },
    {
      id: "collect",
      title: "What we collect",
      body: (
        <>
          <p>What we hold depends on how you use {site}.</p>
          <List>
            <Item term="Your account">
              your name, email address and handle. If you sign in with Google, Google tells
              us your name and email. If you use a password, we keep only a one-way hash of
              it (scrypt), never the password itself. Your profile holds what you choose to
              add: a headline, a few words about you, your city, links (a website, GitHub,
              LinkedIn) and a phone number, which is stored encrypted.
            </Item>
            <Item term="Two-factor sign-in">
              if you turn it on, the secret for your authenticator app (encrypted), and
              backup and emailed codes stored only as hashes.
            </Item>
            <Item term="Your code and work">
              code you run or submit, with its results; your working copy, saved every few
              seconds while you type, with a history of changes (the latest 2,000 per problem
              and language); answers to quiz questions; notes and lists; discussion posts,
              peer reviews and links to GitHub repositories you hand in.
            </Item>
            <Item term="Organization records">
              if your organization uses these parts of {site}: your classes and groups,
              attendance, timetable, marks and report cards, leave requests, library loans,
              bus route, hostel bed, admission applications and student records. A student
              record&apos;s date of birth, phone number and address, and the same details in
              admission applications, are stored encrypted. For staff, the details an
              organization keeps about you (designation, department, staff number, the date
              you joined, and a work phone, stored encrypted).
            </Item>
            <Item term="Billing">
              if your organization pays for a plan: the billing details it gives (legal name,
              GSTIN, address and billing email), its plan, what each payment was for, who
              made it and when, and its invoices. Card, UPI and bank details go straight to
              our payment provider; we never see or keep them, only the provider&apos;s
              reference for each payment.
            </Item>
            <Item term="Feedback on teachers">
              if your organization runs feedback rounds: your ratings and comments about the
              teachers of your subjects. They&apos;re kept with your account only so you answer once
              and are reminded until you have; teachers and the people running the round see
              averages and comments, never who gave them, and nothing until at least three students
              have answered.
            </Item>
            <Item term="Solution posts">
              if you share a solution to a library problem: your write-up, the code from the accepted
              submission you chose, your votes, comments and reports. People who&apos;ve solved the
              problem see the post with your name; moderators see how often a post was reported,
              never who reported it. You can delete your post or comments at any time.
            </Item>
            <Item term="Parents and guardians">
              the link between a parent&apos;s account and their child&apos;s, made by the
              organization.
            </Item>
            <Item term="Lab exams">
              during a timed exam, the network address you start and submit from (when your
              teacher limits the exam to a lab&apos;s network), and records of leaving the tab
              or full screen and of pasting text that wasn&apos;t copied on the page.
            </Item>
            <Item term="Activity and security">
              the network address and browser of actions recorded in an organization&apos;s
              or the platform&apos;s activity log, and failed sign-in attempts. To stop anyone
              hammering the site, we count how often each network address signs in, signs up,
              asks for emailed links or opens {site} from a learning management system.
            </Item>
            <Item term="The contact form">
              if you write to us from the front page: your name and email, your organization, its
              kind and roughly how many learners it has, your message, and the network address it
              came from, which is used only to limit how often one address can send.
            </Item>
            <Item term="Without an account">
              nothing on our servers about your code: it stays in your browser, and Python
              and JavaScript run on your own device.
            </Item>
          </List>
        </>
      ),
    },
    {
      id: "use",
      title: "How we use it",
      body: (
        <>
          <List>
            <li>To run {site}: signing you in, running and grading code, and showing your work, marks and progress to you and to the people allowed to see them.</li>
            <li>To send the emails you&apos;d expect: confirming your address, sign-in codes, password links, security notices, and notifications you can switch off in your notification settings.</li>
            <li>To keep accounts and assessments honest and safe: two-factor sign-in, pausing sign-in after repeated wrong passwords, checking code similarity when a teacher asks, and the exam records above, which are signals for a teacher, not proof.</li>
            <li>To bill organizations that pay for a plan: taking payments, issuing invoices with GST, and reminding those who manage billing before a period ends.</li>
            <li>To fix problems and keep the service running, using error reports and logs.</li>
            <li>To show ads on public practice pages (see <a href="#cookies" className={LINK}>Cookies and ads</a>).</li>
          </List>
          <p>
            We don&apos;t sell your personal data, and we don&apos;t give advertisers your
            name, email or work.
          </p>
        </>
      ),
    },
    {
      id: "see",
      title: "Who can see what",
      body: (
        <List>
          <Item term="You">everything about your own account and work.</Item>
          <Item term="Your organization's staff">
            teachers and administrators see what their role allows for the classes they
            run: your submissions and their results, your working copy and how it was
            written (for assignments they can grade), grades, attendance and records. Every
            change they make to members, roles and settings is recorded. Your profile in an
            organization (your classes, roles, record, parents and contact details) is
            shown to you, your linked parents and its staff who may see members; your
            account&apos;s phone number too.
          </Item>
          <Item term="Your practice">
            your own practice outside the organization&apos;s work is shared with it only if
            you choose to share your progress.
          </Item>
          <Item term="Classmates">
            your discussion posts (shown as &quot;Anonymous&quot; if you post anonymously,
            though teachers still see your name) and, where a teacher sets peer review, your
            code to your reviewers.
          </Item>
          <Item term="Other signed-in people">
            your name and handle on profiles and leaderboards, never your email.
          </Item>
          <Item term="Anyone with a certificate's code">
            its verification page: your name (not your email), the certificate&apos;s title,
            the organization, who issued it and when.
          </Item>
          <Item term="Parents and guardians">
            what their linked child can see about themselves, read only.
          </Item>
          <Item term="Enquiries">
            what you send through the contact form is read by the people who run {site} and look
            after new organizations, and emailed to them. It isn't shared with anyone else.
          </Item>
          <Item term="Our staff">
            people who run {site} may see data to support an organization or keep the
            service safe; when they act inside an organization it is recorded in that
            organization&apos;s activity log.
          </Item>
          <Item term="Systems your organization connects">
            if your organization links a learning management system (such as Moodle or
            Canvas) or its own systems through API keys and webhooks, the data it chooses
            goes to them, under its own responsibility.
          </Item>
        </List>
      ),
    },
    {
      id: "providers",
      title: "Service providers",
      body: (
        <>
          <p>{we} uses these companies to run the service. They handle data only to provide their service to us.</p>
          <List>
            <Item term="Vercel">hosting the website, in Mumbai, India.</Item>
            <Item term="Supabase">the database, in Mumbai, India.</Item>
            <Item term="Amazon Web Services">the servers that run submitted code, in Sydney, Australia, in an isolated sandbox with no network access.</Item>
            <Item term="Neon">an earlier copy of the database, in Sydney, Australia, kept until early December 2026 in case we need to move back, then deleted.</Item>
            <Item term="Google">sign-in with Google, and AdSense ads on public practice pages.</Item>
            <Item term="Our email provider">sending the emails described above.</Item>
            <Item term="Razorpay">taking payments for organizations&apos; plans (UPI, cards and net banking), in India.</Item>
            <Item term="GitHub">looking up the commit of a repository link you hand in for a project.</Item>
            <Item term="Cloudflare">storing and serving files: images in problems and lessons (public, like the pages that show them), and the exports and import reports you download (private, reached only through a link that works for a few minutes). Stored in its Asia-Pacific region.</Item>
          </List>
          <p>
            Because of these providers, your data may be stored and processed outside your
            country: in India, where the website and the database run; in Australia, where
            submitted code is run; in the Asia-Pacific region, where files are stored; and
            wherever these providers operate.
          </p>
        </>
      ),
    },
    {
      id: "cookies",
      title: "Cookies and ads",
      body: (
        <>
          <List>
            <Item term="Signed in">a cookie that keeps you signed in, which scripts on the page can&apos;t read.</Item>
            <Item term="Trusted browser">if you tick &quot;Don&apos;t ask again on this browser&quot;, a signed cookie that skips the second sign-in step for 30 days.</Item>
            <Item term="Preferences">small cookies and browser storage remembering your choices: Learn or Teach, which organizations&apos; content to show, light or dark theme, editor settings and folded menus.</Item>
            <Item term="Your code without an account">kept in your browser&apos;s storage, on that device only.</Item>
          </List>
          <p>
            Public practice pages show ads from Google AdSense. Google and its partners use
            cookies to show ads based on your visits to this and other websites. Read{" "}
            <a className={LINK} href="https://policies.google.com/technologies/partner-sites">
              how Google uses this data
            </a>{" "}
            and turn off personalized ads in{" "}
            <a className={LINK} href="https://adssettings.google.com">
              Ads Settings
            </a>
            . Assignments, exams, classes and organization pages have no ads.
          </p>
        </>
      ),
    },
    {
      id: "keep",
      title: "How long we keep it",
      body: (
        <>
          <p>
            We keep your account and work while your account exists, and organization
            records for as long as the organization keeps them, since marks, attendance and
            certificates are records it may need for years. Some things go sooner:
          </p>
          <List>
            <li>Invoices and payment records are kept for as long as India&apos;s tax and accounting laws require (up to eight years), even after an organization stops using {site}.</li>
            <li>Those counts of how often a network address did something are deleted after a day.</li>
            <li>Emailed sign-in codes last 10 minutes, and password and confirmation links an hour or a day; each works once.</li>
            <li>Records of emails sent are deleted after 7 days, and of emails that failed after 30.</li>
            <li>An enquiry from the contact form is kept so we can follow it up; write to us to have yours deleted.</li>
            <li>Your working copy keeps its latest 2,000 changes per problem and language.</li>
            <li>Exam network addresses are kept until the teacher removes them, which they can do once they no longer need them.</li>
            <li>A file you export, and an import&apos;s report, are kept for a day so you can download them; the rows of a big import are kept, encrypted, only until it&apos;s added (or a day at most).</li>
          </List>
          <p>
            When you ask us to delete your account, we delete or anonymize your personal data
            within a reasonable time, except what the law requires us to keep and records an
            organization must keep, which we discuss with it.
          </p>
        </>
      ),
    },
    {
      id: "security",
      title: "How we protect it",
      body: (
        <>
          <p>
            Submitted code runs in throwaway sandboxes (gVisor) with no network and no access
            to the database or other people&apos;s data. Passwords are hashed; sensitive personal
            details and two-factor secrets are encrypted; connections use HTTPS; and who may
            see what is checked on every request, so taking someone&apos;s role away works at
            once. You can add two-factor sign-in and sign out of every device from your
            account&apos;s Security page.
          </p>
          <p>
            No system is perfectly secure. If a breach affects your personal data, we will
            tell you and the authorities as the law requires.
          </p>
        </>
      ),
    },
    {
      id: "rights",
      title: "Your rights and choices",
      body: (
        <>
          <p>Wherever you live, you can ask us to:</p>
          <List>
            <li>tell you what personal data we hold about you and give you a copy;</li>
            <li>correct data that is wrong or out of date;</li>
            <li>delete your account and data;</li>
            <li>withdraw consent you gave, without affecting what was done before;</li>
            <li>name someone to act for you if you die or become unable to (in India, under the Digital Personal Data Protection Act, 2023).</li>
          </List>
          <p>
            Write to us (see <a href="#contact" className={LINK}>Contact</a>) from the email
            address on your account; this is also how to delete your account, as there is no
            button for it on the site. We may ask you to confirm it&apos;s you. For records an organization keeps, such as marks or
            attendance, ask the organization; we will help it answer. You can also change
            many things yourself: your notification settings and emails, whether your
            organization sees your practice, your calendar link, and your sign-in methods.
          </p>
          <p>
            If you&apos;re not satisfied with our answer, you can complain to your data
            protection authority; in India, the Data Protection Board of India.
          </p>
        </>
      ),
    },
    {
      id: "children",
      title: "Children",
      body: (
        <p>
          {site} is used by schools, so many of its students are under 18. Students under
          18 should use it through their school or with a parent or guardian&apos;s
          permission. An organization that adds students confirms it has the consent the
          law requires from them or their parents. If you believe a child has signed up
          without it, write to us and we will delete the account.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to this policy",
      body: (
        <p>
          When we change this policy, we update the date at the top. If a change matters to
          how your data is used, we will tell you by email or on the site before it takes
          effect.
        </p>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: (
        <>
          <p>For privacy questions, requests and complaints:</p>
          <Contact facts={facts} />
        </>
      ),
    },
  ]

  return (
    <LegalPage
      facts={facts}
      current="/privacy"
      title="Privacy policy"
      intro={
        <p className="text-body-md">
          What {site} keeps about you, why, who can see it, and what you can do about it.
          It applies to {site} at{" "}
          <Link href="/" className={LINK}>
            {facts.url.replace(/^https?:\/\//, "")}
          </Link>{" "}
          and its sign-in, email and API.
        </p>
      }
      summary={[
        <>Without an account, your code stays in your browser.</>,
        <>With one, your code and work are kept so you and the teachers of your classes can see them.</>,
        <>Your school or organization decides what it records about you; ask it first about those records.</>,
        <>We don&apos;t sell your data. Ads appear only on public practice pages.</>,
        <>You can ask to see, correct or delete your data at any time.</>,
      ]}
      sections={sections}
    />
  )
}
