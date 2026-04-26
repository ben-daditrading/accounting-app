import Link from "next/link";

const milestones = [
  {
    title: "Schema chosen",
    description: "Transactions, source lines, journal entries, receipts, accounts, and audit log are now codified.",
  },
  {
    title: "Entry UI started",
    description: "The first-pass transaction entry form already models balancing debits and credits.",
  },
  {
    title: "Migration approach defined",
    description: "We will normalize spreadsheet data before importing it into clean production tables.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-12 lg:px-8">
        <section className="grid gap-8 lg:grid-cols-[1.3fr_0.9fr] lg:items-start">
          <div className="space-y-6">
            <div className="inline-flex rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-600">
              Dadi Trading internal accounting prototype
            </div>
            <div className="space-y-4">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                Replace the spreadsheet with a clean transaction and journal entry workflow.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-zinc-600">
                This prototype is built for simple internal data entry, proper relational storage, and safer future querying than the current Excel layout allows.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/login"
                className="rounded-xl bg-zinc-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-800"
              >
                Sign in
              </Link>
              <Link
                href="/transactions/new"
                className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
              >
                Open entry prototype
              </Link>
              <Link
                href="/transactions"
                className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
              >
                View transaction list
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Decisions locked</h2>
            <ul className="mt-4 space-y-3 text-sm text-zinc-700">
              <li>• One receipt per transaction</li>
              <li>• Edits allowed, with full audit log</li>
              <li>• Multi-currency from day one</li>
              <li>• Account names first, account codes later if needed</li>
              <li>• Subdomain target: accounting.daditrading.com</li>
            </ul>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {milestones.map((milestone) => (
            <article key={milestone.title} className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold">{milestone.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600">{milestone.description}</p>
            </article>
          ))}
        </section>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="text-xl font-semibold">What v1 is optimizing for</h2>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-zinc-600">
                <li>• very simple manual data entry</li>
                <li>• preserving the current spreadsheet mental model</li>
                <li>• better queryability by account and transaction</li>
                <li>• future receipt upload and OCR-assisted draft creation</li>
                <li>• simple in-app email/password auth for the internal team</li>
              </ul>
            </div>
            <div>
              <h2 className="text-xl font-semibold">What still comes next</h2>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-zinc-600">
                <li>• database connection and persistence</li>
                <li>• receipt upload to Cloudflare R2</li>
                <li>• CSV import and normalization tools</li>
                <li>• deployment through Docker, Tunnel, and Supabase Auth</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
