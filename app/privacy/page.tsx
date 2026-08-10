import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What the Bhai Thik Kor website and browser extension send, store, and never collect.",
};

const UPDATED = "10 August 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-semibold tracking-tight sm:text-xl">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300 sm:text-base">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated: {UPDATED}</p>

      <Section title="What we send">
        <p>
          Bhai Thik Kor improves prompts. When you ask for an improvement — by clicking a button,
          using the right-click menu, or pressing the keyboard shortcut — the text you selected or
          typed is sent to our server at bhaithikkor.vercel.app, improved by an AI model, and sent
          back to you.
        </p>
        <p>
          Nothing is sent until you ask. The extension does not log keystrokes, does not read page
          content on its own, and does not send anything in the background.
        </p>
      </Section>

      <Section title="What we skip">
        <p>
          The extension refuses to read password, payment card, one-time-code, banking, and medical
          fields, along with pages whose address looks like a login, checkout, banking, or medical
          portal. Disabled and read-only fields are skipped too.
        </p>
      </Section>

      <Section title="What we store">
        <p>
          We do not keep your prompts. Our servers log only operational data — which endpoint was
          called, whether it succeeded, how long it took, how many characters were sent, and the
          coarse type of any error. That data contains no prompt text and expires after 14 days.
        </p>
        <p>
          We use your IP address to enforce rate limits (50 improvements per day). It is not stored
          alongside your prompt text and is not used to build a profile.
        </p>
        <p>
          The extension&apos;s optional history is off by default. When you turn it on, your last 50
          prompts are stored on your own device using the browser&apos;s local extension storage.
          They never reach our servers and never sync between devices. Turning history off deletes
          them.
        </p>
      </Section>

      <Section title="What we never do">
        <ul className="list-disc space-y-2 pl-5">
          <li>We do not sell your data.</li>
          <li>We do not use your prompts for advertising or tracking.</li>
          <li>We do not require an account, and we do not know who you are.</li>
          <li>We do not put your prompt text into any website address.</li>
        </ul>
      </Section>

      <Section title="AI providers">
        <p>
          To improve a prompt we pass your text to one of our model providers — Groq, Google
          (Gemini), or OpenRouter — under their API terms. We send only your prompt text and any
          clarifications you provided.
        </p>
      </Section>

      <Section title="Permissions the extension asks for">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="font-semibold text-slate-900 dark:text-slate-100">
              Access to sites you visit
            </strong>{" "}
            — so the improve button can appear next to the text box you are writing in. You can turn
            this off globally or per site in the extension&apos;s settings.
          </li>
          <li>
            <strong className="font-semibold text-slate-900 dark:text-slate-100">Storage</strong> —
            to remember your settings and, if you enable it, your local history.
          </li>
          <li>
            <strong className="font-semibold text-slate-900 dark:text-slate-100">Context menu</strong>{" "}
            — for the right-click &quot;Improve with Bhai Thik Kor&quot; entry.
          </li>
        </ul>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy:{" "}
          <a
            className="font-medium text-[var(--accent)] hover:underline"
            href="mailto:nidanalam73@gmail.com"
          >
            nidanalam73@gmail.com
          </a>
        </p>
        <p>
          Code and issues:{" "}
          <a
            className="font-medium text-[var(--accent)] hover:underline"
            href="https://github.com/Nidan73"
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/Nidan73
          </a>
        </p>
      </Section>

      <p className="mt-12 text-sm">
        <a className="font-medium text-[var(--accent)] hover:underline" href="/">
          ← Back to Bhai Thik Kor
        </a>
      </p>
    </main>
  );
}
