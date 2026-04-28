import { BatchReceiptImport } from "@/components/batch-receipt-import";

export default function BatchImportPage() {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Batch receipt import</h1>
        <p className="mt-1 text-sm text-zinc-500">Review, fix, and submit a backlog of receipts in one place.</p>
      </div>
      <BatchReceiptImport />
    </div>
  );
}
