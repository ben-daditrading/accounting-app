import { BatchStatementImport } from "@/components/batch-statement-import";

export default function StatementImportPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Bank statement import</h1>
        <p className="mt-1 text-sm text-zinc-500">Review, fix, and submit a backlog of bank statement transactions in one place.</p>
      </div>
      <BatchStatementImport />
    </div>
  );
}
