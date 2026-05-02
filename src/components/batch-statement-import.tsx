"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCcw, Trash2, Upload, XCircle } from "lucide-react";

import type { TransactionInput } from "@/lib/validation/transaction";

type BatchSummary = {
  batchId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  sourceName: string | null;
  status: string;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  statementSerial: string | null;
  institutionName: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  counts: {
    total: number;
    processed: number;
    queued: number;
    processing: number;
    ready: number;
    needsReview: number;
    duplicate: number;
    error: number;
    deleted: number;
    submitted: number;
  };
};

type BatchItem = {
  itemId: string;
  batchId: string;
  sourceFileName: string;
  status: string;
  colorState: "green" | "yellow" | "red" | "gray";
  confidenceScore: string;
  confidenceReason: string | null;
  statementDate: string | null;
  rawDescription: string | null;
  direction: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  runningBalance: string | null;
  accountSerial: string | null;
  duplicateMatchesJson: Array<{ transactId: string; description: string; transactDate: string; totalAmount: string; accountSerial: string | null }> | null;
  proposedTransactionJson: TransactionInput | null;
  editedTransactionJson: TransactionInput | null;
  warningsJson: string[] | null;
  errorMessage: string | null;
  postedTransactId: string | null;
};

const input = "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-zinc-400";
const selectInput = input;

function emptyLine() {
  return { drCr: "DR" as const, accountId: 0, accountSerial: "", amount: "", currency: "CAD", amountCad: "", memo: "" };
}

export function BatchStatementImport() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batch, setBatch] = useState<BatchSummary | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [accounts, setAccounts] = useState<Array<{ accountId: number; accountNumber: string; accountName: string; internalKey?: string | null; accountDescription?: string | null }>>([]);
  const [types, setTypes] = useState<Array<{ typeId: number; typeName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeBatchId = batch?.batchId ?? null;

  const loadBatch = useCallback(async (batchId: string) => {
    const [batchRes, itemsRes] = await Promise.all([
      fetch(`/api/statement-batches/${batchId}`, { cache: "no-store" }),
      fetch(`/api/statement-batches/${batchId}/items`, { cache: "no-store" }),
    ]);
    if (!batchRes.ok) throw new Error("Failed to load statement batch");
    setBatch(await batchRes.json());
    if (!itemsRes.ok) throw new Error("Failed to load statement items");
    setItems(await itemsRes.json());
  }, []);

  const loadBatches = useCallback(async (preferredBatchId?: string | null) => {
    const [batchesRes, accountsRes, typesRes] = await Promise.all([
      fetch("/api/statement-batches", { cache: "no-store" }),
      fetch("/api/accounts", { cache: "no-store" }),
      fetch("/api/transaction-types", { cache: "no-store" }),
    ]);
    if (!batchesRes.ok) throw new Error("Failed to load statement batches");
    const batchesJson = (await batchesRes.json()) as BatchSummary[];
    setBatches(batchesJson);
    if (accountsRes.ok) setAccounts(await accountsRes.json());
    if (typesRes.ok) setTypes(await typesRes.json());
    const nextBatchId = preferredBatchId ?? activeBatchId ?? batchesJson[0]?.batchId ?? null;
    if (nextBatchId) await loadBatch(nextBatchId);
    else {
      setBatch(null);
      setItems([]);
    }
  }, [activeBatchId, loadBatch]);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        await loadBatches();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load statement import page");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void bootstrap();
    return () => { cancelled = true; };
  }, [loadBatches]);

  useEffect(() => {
    if (!activeBatchId) return;
    if (batch?.status !== "processing" && batch?.status !== "submitting") return;
    const id = window.setInterval(() => { loadBatch(activeBatchId).catch(() => {}); }, 2500);
    return () => window.clearInterval(id);
  }, [activeBatchId, batch?.status, loadBatch]);

  const unresolvedCount = useMemo(() => items.filter((item) => !["ready", "deleted", "submitted"].includes(item.status)).length, [items]);
  const readyToSubmit = Boolean(batch && items.length > 0 && unresolvedCount === 0 && items.every((item) => ["ready", "deleted", "submitted"].includes(item.status)) && batch.status !== "processing");

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      const res = await fetch("/api/statement-batches", { method: "POST", body: formData });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Upload failed");
      await loadBatches(payload.batchId ?? null);
      if (payload?.batchId) await loadBatch(payload.batchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function updateTransactionField(itemId: string, updater: (transaction: TransactionInput) => TransactionInput) {
    setItems((current) => current.map((item) => {
      if (item.itemId !== itemId) return item;
      const base = item.editedTransactionJson ?? item.proposedTransactionJson;
      if (!base) return item;
      return { ...item, editedTransactionJson: updater(base) };
    }));
  }

  async function saveItem(item: BatchItem, status: "ready" | "needs_review" | "deleted") {
    const transaction = item.editedTransactionJson ?? item.proposedTransactionJson;
    if (status !== "deleted" && !transaction) {
      setError(`No editable transaction payload exists for ${item.sourceFileName}`);
      return;
    }
    const res = await fetch(`/api/statement-batches/items/${item.itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction, status }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.error ?? "Failed to update row");
      return;
    }
    await loadBatch(item.batchId);
  }

  async function handleSubmitBatch() {
    if (!activeBatchId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/statement-batches/${activeBatchId}/submit`, { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to submit batch");
      await loadBatch(activeBatchId);
      await loadBatches(activeBatchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit batch");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading statement import…</div>;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">Upload bank statements</h2>
            <p className="mt-1 text-sm text-zinc-500">Upload a zip or multiple statement files. Results appear in the review grid as parsing finishes.</p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" multiple accept=".zip,.pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(event) => handleUpload(event.target.files)} />
            <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading…" : "Upload statements"}
            </button>
            {activeBatchId ? <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50" onClick={() => loadBatch(activeBatchId)}><RefreshCcw className="h-4 w-4" /> Refresh</button> : null}
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-xl border border-zinc-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-zinc-950">Recent statement batches</h3>
          <div className="mt-3 space-y-2">
            {batches.length === 0 ? <p className="text-sm text-zinc-500">No statement batches yet.</p> : null}
            {batches.map((candidate) => (
              <button key={candidate.batchId} type="button" className={`w-full rounded-lg border px-3 py-3 text-left text-sm ${candidate.batchId === activeBatchId ? "border-zinc-950 bg-zinc-50" : "border-zinc-200 hover:bg-zinc-50"}`} onClick={() => loadBatch(candidate.batchId)}>
                <div className="font-medium text-zinc-900">{candidate.sourceName ?? candidate.batchId}</div>
                <div className="mt-1 text-xs text-zinc-500">{candidate.statementSerial ?? "Unknown serial"}</div>
                <div className="mt-1 text-xs text-zinc-500">{candidate.statementPeriodStart ?? "?"} → {candidate.statementPeriodEnd ?? "?"}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                  <span>{candidate.counts.total} rows</span>
                  <span>{candidate.counts.ready} ready</span>
                  <span>{candidate.counts.needsReview} yellow</span>
                  <span>{candidate.counts.duplicate + candidate.counts.error} red</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          {!batch ? <p className="text-sm text-zinc-500">Upload a statement to begin.</p> : (
            <>
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950">{batch.sourceName ?? batch.batchId}</h3>
                  <p className="mt-1 text-xs text-zinc-500">{batch.institutionName ?? "Unknown institution"} • {batch.statementSerial ?? "No serial"} • {batch.statementPeriodStart ?? "?"} to {batch.statementPeriodEnd ?? "?"}</p>
                  <p className="mt-1 text-xs text-zinc-500">Opening {batch.openingBalance ?? "?"} • Closing {batch.closingBalance ?? "?"}</p>
                </div>
                <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50" onClick={handleSubmitBatch} disabled={!readyToSubmit || submitting}>
                  {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {submitting ? "Submitting…" : "Submit batch"}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="border-b border-zinc-200 text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2">Withdraw</th>
                      <th className="px-3 py-2">Deposit</th>
                      <th className="px-3 py-2">Balance</th>
                      <th className="px-3 py-2">Serial</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const expanded = expandedRows[item.itemId] ?? false;
                      const tx = item.editedTransactionJson ?? item.proposedTransactionJson;
                      return (
                        <>
                          <tr key={item.itemId} className="border-b border-zinc-100 align-top">
                            <td className="px-3 py-2"><StatusBadge item={item} /></td>
                            <td className="px-3 py-2">{item.statementDate ?? "—"}</td>
                            <td className="px-3 py-2">
                              <button type="button" className="text-left font-medium text-zinc-900 underline-offset-2 hover:underline" onClick={() => setExpandedRows((current) => ({ ...current, [item.itemId]: !expanded }))}>
                                {item.rawDescription ?? item.sourceFileName}
                              </button>
                              {item.duplicateMatchesJson?.length ? <p className="mt-1 text-[11px] text-red-600">Possible duplicate</p> : null}
                            </td>
                            <td className="px-3 py-2">{item.withdrawalAmount ?? "—"}</td>
                            <td className="px-3 py-2">{item.depositAmount ?? "—"}</td>
                            <td className="px-3 py-2">{item.runningBalance ?? "—"}</td>
                            <td className="px-3 py-2">{item.accountSerial ?? "—"}</td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-2">
                                <button type="button" className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-100" onClick={() => saveItem(item, "ready")}>Ready</button>
                                <button type="button" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100" onClick={() => saveItem(item, "needs_review")}>Review</button>
                                <button type="button" className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100" onClick={() => saveItem(item, "deleted")}>Delete</button>
                              </div>
                            </td>
                          </tr>
                          {expanded && tx ? (
                            <tr className="border-b border-zinc-200 bg-zinc-50/70">
                              <td colSpan={8} className="px-3 py-3">
                                <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
                                  <div className="space-y-3">
                                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                      <input className={input} value={tx.transactDate} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, transactDate: event.target.value }))} />
                                      <select className={selectInput} value={String(tx.typeId)} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, typeId: Number(event.target.value) }))}>
                                        {types.map((type) => <option key={type.typeId} value={type.typeId}>{type.typeName}</option>)}
                                      </select>
                                      <input className={input} value={tx.totalAmount} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, totalAmount: event.target.value }))} />
                                      <input className={input} value={tx.currency} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, currency: event.target.value }))} />
                                    </div>
                                    <input className={input} value={tx.description} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, description: event.target.value }))} />
                                    <div className="space-y-2">
                                      {tx.journalLines.map((line, index) => (
                                        <div key={`${item.itemId}-${index}`} className="grid gap-2 sm:grid-cols-[80px_1fr_140px_110px_90px_1fr_36px]">
                                          <select className={selectInput} value={line.drCr} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, journalLines: transaction.journalLines.map((current, currentIndex) => currentIndex === index ? { ...current, drCr: event.target.value as "DR" | "CR" } : current) }))}>
                                            <option value="DR">DR</option>
                                            <option value="CR">CR</option>
                                          </select>
                                          <select className={selectInput} value={String(line.accountId)} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, journalLines: transaction.journalLines.map((current, currentIndex) => currentIndex === index ? { ...current, accountId: Number(event.target.value) } : current) }))}>
                                            <option value="0">Account…</option>
                                            {accounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.accountNumber} — {account.accountName}</option>)}
                                          </select>
                                          <input className={input} placeholder="Acct serial / last4" value={line.accountSerial ?? ""} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, journalLines: transaction.journalLines.map((current, currentIndex) => currentIndex === index ? { ...current, accountSerial: event.target.value } : current) }))} />
                                          <input className={input} value={line.amount} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, journalLines: transaction.journalLines.map((current, currentIndex) => currentIndex === index ? { ...current, amount: event.target.value } : current) }))} />
                                          <select className={selectInput} value={line.currency} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, journalLines: transaction.journalLines.map((current, currentIndex) => currentIndex === index ? { ...current, currency: event.target.value } : current) }))}>
                                            <option value="CAD">CAD</option>
                                            <option value="USD">USD</option>
                                            <option value="CNY">CNY</option>
                                          </select>
                                          <input className={input} value={line.memo ?? ""} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, journalLines: transaction.journalLines.map((current, currentIndex) => currentIndex === index ? { ...current, memo: event.target.value } : current) }))} />
                                          <button type="button" className="rounded-md border border-zinc-200 text-zinc-500 hover:bg-white" onClick={() => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, journalLines: transaction.journalLines.filter((_, currentIndex) => currentIndex !== index) }))}>×</button>
                                        </div>
                                      ))}
                                      <button type="button" className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] hover:bg-white" onClick={() => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, journalLines: [...transaction.journalLines, emptyLine()] }))}>Add line</button>
                                    </div>
                                  </div>
                                  <div className="space-y-3">
                                    <textarea className={`${input} min-h-[90px]`} value={tx.notes ?? ""} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, notes: event.target.value }))} />
                                    {item.warningsJson?.length ? <ul className="space-y-1 text-[11px] text-amber-700">{item.warningsJson.map((warning) => <li key={warning}>• {warning}</li>)}</ul> : null}
                                    {item.duplicateMatchesJson?.length ? <ul className="space-y-1 text-[11px] text-red-700">{item.duplicateMatchesJson.map((match) => <li key={match.transactId}>Possible duplicate: {match.transactId} • {match.description} • {match.totalAmount}</li>)}</ul> : null}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </section>
    </div>
  );
}

function StatusBadge({ item }: { item: BatchItem }) {
  const styles: Record<BatchItem["colorState"], string> = {
    green: "bg-emerald-100 text-emerald-700 border-emerald-200",
    yellow: "bg-amber-100 text-amber-700 border-amber-200",
    red: "bg-red-100 text-red-700 border-red-200",
    gray: "bg-zinc-100 text-zinc-600 border-zinc-200",
  };
  const Icon = item.colorState === "green" ? CheckCircle2 : item.colorState === "yellow" ? AlertTriangle : item.colorState === "red" ? XCircle : Trash2;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium ${styles[item.colorState]}`}><Icon className="h-3 w-3" /> {item.status.replace(/_/g, " ")}</span>;
}
