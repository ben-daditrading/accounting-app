import { TransactionEntryForm } from "@/components/transaction-entry-form";

export default function NewTransactionPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-lg font-semibold">New transaction</h1>
      <div className="mt-6">
        <TransactionEntryForm />
      </div>
    </div>
  );
}
