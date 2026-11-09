import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What the Bhai Thik Kor website and browser extension send, store, and never collect.",
};

const UPDATED = "4 November 2026";

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
          Bhai Thik Kor improves prompts. When you ask for an improvement (by clicking a button,
          using the right-click menu, or pressing the keyboard shortcut), the text you selected or
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
          We do not keep your prompts. Our servers log only operational data: which endpoint was
          called, whether it succeeded, how long it took, how many characters were sent, and the
          coarse type of any error. Error logs record the error type and status only, never prompt
          text. That data expires after 14 days.
        </p>
        <p>
          We use your IP address to enforce rate limits, with a separate daily limit for each
          feature (50 improvements per day, plus caps on guided questions, tweaks, and link
          reading). For IPv6 addresses we use the surrounding /64 network instead of the full
          address. It is held only for the length of the limit window, at most two days, is not
          stored alongside your prompt text, and is not used to build a profile.
        </p>
        <p>
          On the website, your last 10 generated prompts are kept in your browser&apos;s local
          storage so you can reopen them. They stay on your device, and the Clear button in the
          history panel removes them. The Share button puts the prompt in the part of the link
          after the <span className="font-mono text-sm">#</span>, which browsers do not send to
          any server.
        </p>
        <p>
          The extension&apos;s optional history is off by default. When you turn it on, your last 50
          prompts are stored on your own device using the browser&apos;s local extension storage.
          They never reach our servers and never sync between devices. Turning history off deletes
          them. The history itself stays on your device. If you turn on the extension&apos;s
          Adaptive Style, the custom style you type in its settings is sent with your requests; if
          you leave that empty and history is on, a short style summary built from your history is
          sent instead.
        </p>
      </Section>

      <Section title="What we never do">
        <ul className="list-disc space-y-2 pl-5">
          <li>We do not sell your data.</li>
          <li>We do not use your prompts for advertising or tracking.</li>
          <li>We do not require an account, and we do not know who you are.</li>
          <li>The extension never puts your prompt text into any website address.</li>
        </ul>
      </Section>

      <Section title="AI providers">
        <p>
          To improve a prompt we pass your text to one of our model providers (Groq, Google
          (Gemini), or OpenRouter) under their API terms. We send your text, any answers you gave
          in Guided Mode, guidance the extension adds to improve quality, a summary of attached
          files (how many and of what kind, never names or contents), and, if you turned on
          Adaptive Style, either the custom style you typed or, when you left it empty and history
          is on, a short style summary built from your history. If you used page extraction, the text we pulled from the
          page you linked is sent along with your prompt.
        </p>
      </Section>

      <Section title="Reading a link you paste">
        <p>
          If you paste a web address to pull its text into a prompt, we fetch that page so we can
          extract its readable content. We first ask Jina AI&apos;s reader service (
          <span className="font-mono text-sm">r.jina.ai</span>) to render it, which means the address
          you pasted is sent to Jina AI under their terms; if that does not work, our own server
          fetches the page directly.
        </p>
        <p>
          Only the address is shared for this, never your prompt text. We keep at most the first few
          thousand characters of the page, and only for as long as it takes to build your prompt. We
          refuse addresses that point at private or internal networks. Our server logs the
          site&apos;s domain name for this feature, not the full address and not the page text.
        </p>
      </Section>

      <Section title="Website analytics">
        <p>
          The website uses Vercel Web Analytics for anonymous page-view statistics. It is used to
          see how many people visit, not to identify you or follow you across sites.
        </p>
      </Section>

      <Section title="Permissions the extension asks for">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="font-semibold text-slate-900 dark:text-slate-100">
              Access to sites you visit
            </strong>
            : so the improve button can appear next to the text box you are writing in. You can turn
            this off globally or per site in the extension&apos;s settings.
          </li>
          <li>
            <strong className="font-semibold text-slate-900 dark:text-slate-100">Storage</strong>:
            to remember your settings and, if you enable it, your local history.
          </li>
          <li>
            <strong className="font-semibold text-slate-900 dark:text-slate-100">Context menu</strong>
            : for the right-click &quot;Improve with Bhai Thik Kor&quot; entry.
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
        <Link className="font-medium text-[var(--accent)] hover:underline" href="/">
          ← Back to Bhai Thik Kor
        </Link>
      </p>
    </main>
  );
}
