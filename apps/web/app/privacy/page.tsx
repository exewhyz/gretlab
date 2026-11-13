import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = { title: "Privacy" }

const LINK = "underline underline-offset-2 hover:text-ink"

export default function PrivacyPage() {
  return (
    <main className="mx-auto grid max-w-2xl gap-4 px-4 py-20 text-body-md text-body">
      <h1 className="text-display-lg text-ink">Privacy</h1>

      <h2 className="mt-4 text-title-md text-ink">Your code and progress</h2>
      <p>
        Without an account, your code, progress and panel layout stay in your
        own browser, and Python runs on your own device. They don&apos;t move to
        another computer or browser.
      </p>
      <p>
        When you sign in and press Run or Submit, your code is sent to this
        site, run in an isolated sandbox, and kept with its results. Teachers
        and administrators of this site can read your submissions.
      </p>

      <h2 className="mt-4 text-title-md text-ink">Accounts</h2>
      <p>
        You sign in with Google, which shares your name and email with this
        site, or with your email and a password. Passwords are stored only as a
        one-way hash, never as typed. A cookie keeps you signed in. Contest leaderboards show your name
        to other visitors, but never your email.
      </p>

      <h2 className="mt-4 text-title-md text-ink">Advertising</h2>
      <p>
        This site shows ads from Google AdSense to help pay for itself. Google
        and its partners use cookies to serve ads based on your visits to this
        and other websites. You can read{" "}
        <a
          className={LINK}
          href="https://policies.google.com/technologies/partner-sites"
        >
          how Google uses this data
        </a>
        , and turn off personalized ads in{" "}
        <a className={LINK} href="https://adssettings.google.com">
          Ads Settings
        </a>
        .
      </p>

      <Link href="/" className={`mt-4 ${LINK}`}>
        Back to the problems
      </Link>
    </main>
  )
}
