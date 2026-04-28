"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, LoaderCircle, RefreshCcw, Trash2, Upload, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

import type { TransactionInput } from "@/lib/validation/transaction";

type BatchSummary = {
  batchId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  sourceName: string | null;
  status: string;
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
  mimeType: string;
  status: string;
  colorState: "green" | "yellow" | "red" | "gray";
  confidenceScore: string;
  confidenceReason: string | null;
  ocrRawText: string | null;
  ocrJson: { merchant?: string | null; [key: string]: unknown } | null;
  duplicateMatchesJson: Array<{ transactId: string; description: string; transactDate: string; totalAmount: string }> | null;
  proposedTransactionJson: TransactionInput | null;
  editedTransactionJson: TransactionInput | null;
  warningsJson: string[] | null;
  errorMessage: string | null;
  postedTransactId: string | null;
  postedReceiptRef: string | null;
};

const input = "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-zinc-400";
const selectInput = input;

function emptyLine() {
  return { drCr: "DR" as const, accountId: 0, amount: "", currency: "CAD", amountCad: "", memo: "" };
}

export function BatchReceiptImport() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batch, setBatch] = useState<BatchSummary | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [accounts, setAccounts] = useState<Array<{ accountId: number; accountNumber: string; accountName: string }>>([]);
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
      fetch(`/api/receipt-batches/${batchId}`, { cache: "no-store" }),
      fetch(`/api/receipt-batches/${batchId}/items`, { cache: "no-store" }),
    ]);

    if (!batchRes.ok) throw new Error("Failed to load batch");
    const batchJson = (await batchRes.json()) as BatchSummary;
    setBatch(batchJson);

    if (!itemsRes.ok) throw new Error("Failed to load batch items");
    const itemsJson = (await itemsRes.json()) as BatchItem[];
    setItems(itemsJson);
  }, []);

  const loadBatches = useCallback(async (preferredBatchId?: string | null) => {
    const [batchesRes, accountsRes, typesRes] = await Promise.all([
      fetch("/api/receipt-batches", { cache: "no-store" }),
      fetch("/api/accounts", { cache: "no-store" }),
      fetch("/api/transaction-types", { cache: "no-store" }),
    ]);

    if (!batchesRes.ok) throw new Error("Failed to load receipt batches");
    const batchesJson = (await batchesRes.json()) as BatchSummary[];
    setBatches(batchesJson);

    if (accountsRes.ok) setAccounts(await accountsRes.json());
    if (typesRes.ok) setTypes(await typesRes.json());

    const nextBatchId = preferredBatchId ?? activeBatchId ?? batchesJson[0]?.batchId ?? null;
    if (nextBatchId) {
      await loadBatch(nextBatchId);
    } else {
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
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load batch import page");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [loadBatches]);

  useEffect(() => {
    if (!activeBatchId) return;
    if (batch?.status !== "processing" && batch?.status !== "submitting") return;

    const id = window.setInterval(() => {
      loadBatch(activeBatchId).catch(() => {});
    }, 2500);

    return () => window.clearInterval(id);
  }, [activeBatchId, batch?.status, loadBatch]);

  const unresolvedCount = useMemo(
    () => items.filter((item) => !["ready", "deleted", "submitted"].includes(item.status)).length,
    [items],
  );

  const readyToSubmit = Boolean(
    batch &&
    items.length > 0 &&
    unresolvedCount === 0 &&
    items.every((item) => ["ready", "deleted", "submitted"].includes(item.status)) &&
    batch.status !== "processing",
  );

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      const res = await fetch("/api/receipt-batches", { method: "POST", body: formData });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Upload failed");
      await loadBatches(payload.batchId ?? null);
      if (payload?.batchId) {
        await loadBatch(payload.batchId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function saveItem(item: BatchItem, status: "ready" | "needs_review" | "deleted") {
    const transaction = item.editedTransactionJson ?? item.proposedTransactionJson;
    if (status !== "deleted" && !transaction) {
      setError(`No editable transaction payload exists for ${item.sourceFileName}`);
      return;
    }

    const res = await fetch(`/api/receipt-batches/items/${item.itemId}`, {
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

  const [reprocessing, setReprocessing] = useState<Record<string, boolean>>({});

  async function reprocessItem(item: BatchItem) {
    setReprocessing((s) => ({ ...s, [item.itemId]: true }));
    setError(null);
    try {
      const res = await fetch(`/api/receipt-batches/items/${item.itemId}/reprocess`, { method: "POST" });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.error ?? "Failed to reprocess item");
        return;
      }
      await loadBatch(item.batchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reprocess failed");
    } finally {
      setReprocessing((s) => ({ ...s, [item.itemId]: false }));
    }
  }

  function updateTransactionField(itemId: string, updater: (transaction: TransactionInput) => TransactionInput) {
    setItems((current) =>
      current.map((item) => {
        if (item.itemId !== itemId) return item;
        const base = item.editedTransactionJson ?? item.proposedTransactionJson;
        if (!base) return item;
        return { ...item, editedTransactionJson: updater(base) };
      }),
    );
  }

  async function handleSubmitBatch() {
    if (!activeBatchId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/receipt-batches/${activeBatchId}/submit`, { method: "POST" });
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

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        <LoaderCircle className="h-4 w-4 animate-spin" /> Loading batch import…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">Upload receipts</h2>
            <p className="mt-1 text-sm text-zinc-500">Upload a zip or multiple receipt files. Results appear in the review grid as OCR finishes.</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".zip,.pdf,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(event) => handleUpload(event.target.files)}
            />
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading…" : "Upload receipts"}
            </button>
            {activeBatchId ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                onClick={() => loadBatch(activeBatchId)}
              >
                <RefreshCcw className="h-4 w-4" /> Refresh
              </button>
            ) : null}
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="rounded-xl border border-zinc-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-zinc-950">Recent batches</h3>
          <div className="mt-3 space-y-2">
            {batches.length === 0 ? <p className="text-sm text-zinc-500">No batches yet.</p> : null}
            {batches.map((candidate) => (
              <button
                key={candidate.batchId}
                type="button"
                className={`w-full rounded-lg border px-3 py-3 text-left text-sm ${candidate.batchId === activeBatchId ? "border-zinc-950 bg-zinc-50" : "border-zinc-200 hover:bg-zinc-50"}`}
                onClick={() => loadBatch(candidate.batchId)}
              >
                <div className="font-medium text-zinc-900">{candidate.sourceName ?? candidate.batchId}</div>
                <div className="mt-1 text-xs text-zinc-500">{new Date(candidate.createdAt).toLocaleString()}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                  <span>{candidate.counts.total} files</span>
                  <span>{candidate.counts.ready} ready</span>
                  <span>{candidate.counts.needsReview} yellow</span>
                  <span>{candidate.counts.duplicate + candidate.counts.error} red</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          {!batch ? (
            <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-zinc-500">
              Upload a batch to start reviewing receipts.
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4 border-b border-zinc-200 pb-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950">{batch.sourceName ?? `Batch ${batch.batchId}`}</h3>
                  <p className="mt-1 text-sm text-zinc-500">Status: {batch.status}. Resolve every yellow and red row before submit.</p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                  onClick={handleSubmitBatch}
                  disabled={!readyToSubmit || submitting}
                >
                  {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {submitting ? "Submitting…" : "Submit batch"}
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <StatCard label="Total" value={String(batch.counts.total)} tone="neutral" />
                <StatCard label="Ready" value={String(batch.counts.ready + batch.counts.submitted)} tone="green" />
                <StatCard label="Needs review" value={String(batch.counts.needsReview)} tone="yellow" />
                <StatCard label="Red" value={String(batch.counts.duplicate + batch.counts.error)} tone="red" />
                <StatCard label="Deleted" value={String(batch.counts.deleted)} tone="neutral" />
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-left uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Receipt</th>

                      <th className="px-2 py-2">Date</th>
                      <th className="px-2 py-2">Currency</th>
                      <th className="px-2 py-2">Total</th>
                      <th className="px-2 py-2">Type</th>
                      <th className="px-2 py-2">Description</th>
                      <th className="px-2 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const tx = item.editedTransactionJson ?? item.proposedTransactionJson;
                      const expanded = expandedRows[item.itemId] ?? false;
                      return (
                        <Fragment key={item.itemId}>
                          <tr className="border-b border-zinc-200 align-top">
                            <td className="px-2 py-2">
                              <StatusBadge item={item} />
                              <div className="mt-1 text-[11px] text-zinc-500">{Math.round(Number(item.confidenceScore) * 100)}%</div>
                            </td>
                            <td className="px-2 py-2">
                              <a className="inline-flex items-center gap-1 text-zinc-700 underline" href={`/api/receipt-batches/items/${item.itemId}/file`} target="_blank" rel="noreferrer">
                                <FileText className="h-3.5 w-3.5" /> {item.sourceFileName}
                              </a>
                              {item.postedReceiptRef ? <div className="mt-1 text-[11px] text-emerald-700">Posted</div> : null}
                            </td>

                            <td className="px-2 py-2 min-w-[120px]">
                              <input
                                className={input}
                                type="date"
                                value={tx?.transactDate ?? ""}
                                onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, transactDate: event.target.value }))}
                              />
                            </td>
                            <td className="px-2 py-2 min-w-[90px]">
                              <select
                                className={selectInput}
                                value={tx?.currency ?? "CAD"}
                                onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, currency: event.target.value }))}
                              >
                                <option value="CAD">CAD</option>
                                <option value="USD">USD</option>
                                <option value="CNY">CNY</option>
                              </select>
                            </td>
                            <td className="px-2 py-2 min-w-[100px]">
                              <input
                                className={input}
                                value={tx?.totalAmount ?? ""}
                                onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, totalAmount: event.target.value }))}
                              />
                            </td>
                            <td className="px-2 py-2 min-w-[120px]">
                              <select
                                className={selectInput}
                                value={String(tx?.typeId ?? types[0]?.typeId ?? "")}
                                onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, typeId: Number(event.target.value) }))}
                              >
                                {types.map((type) => (
                                  <option key={type.typeId} value={type.typeId}>{type.typeName}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-2 min-w-[240px]">
                              <input
                                className={input}
                                value={tx?.description ?? ""}
                                onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, description: event.target.value }))}
                              />
                              {item.confidenceReason ? <div className="mt-1 text-[11px] text-zinc-500">{item.confidenceReason}</div> : null}
                            </td>
                            <td className="px-2 py-2 min-w-[220px]">
                              <div className="flex flex-wrap gap-2">
                                <button type="button" className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] hover:bg-zinc-50" onClick={() => setExpandedRows((state) => ({ ...state, [item.itemId]: !expanded }))}>
                                  {expanded ? "Hide lines" : "Edit lines"}
                                </button>
                                <button type="button" className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-100" onClick={() => saveItem(item, "ready")}>
                                  Mark ready
                                </button>
                                <button type="button" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100" onClick={() => saveItem(item, "needs_review")}>
                                  Keep yellow
                                </button>
                                <button type="button" className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-100 disabled:opacity-50" disabled={reprocessing[item.itemId] || item.status === "submitted"} onClick={() => reprocessItem(item)}>
                                  <RefreshCcw className={`mr-1 inline h-3 w-3${reprocessing[item.itemId] ? " animate-spin" : ""}`} /> Rerun OCR
                                </button>
                                <button type="button" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700 hover:bg-red-100" onClick={() => saveItem(item, "deleted")}>
                                  <Trash2 className="mr-1 inline h-3 w-3" /> Delete
                                </button>
                              </div>
                              {item.duplicateMatchesJson?.length ? (
                                <div className="mt-2 text-[11px] text-red-600">Duplicate candidates: {item.duplicateMatchesJson.map((match) => match.transactId).join(", ")}</div>
                              ) : null}
                              {item.errorMessage ? <div className="mt-2 text-[11px] text-red-600">{item.errorMessage}</div> : null}
                            </td>
                          </tr>
                          {expanded && tx ? (
                            <tr className="border-b border-zinc-200 bg-zinc-50/70">
                              <td colSpan={9} className="px-3 py-3">
                                <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
                                  <div>
                                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Journal lines</div>
                                    <div className="space-y-2">
                                      {tx.journalLines.map((line, index) => (
                                        <div key={`${item.itemId}-${index}`} className="grid gap-2 sm:grid-cols-[80px_1fr_110px_90px_1fr_36px]">
                                          <select className={selectInput} value={line.drCr} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({
                                            ...transaction,
                                            journalLines: transaction.journalLines.map((current, currentIndex) => currentIndex === index ? { ...current, drCr: event.target.value as "DR" | "CR" } : current),
                                          }))}>
                                            <option value="DR">DR</option>
                                            <option value="CR">CR</option>
                                          </select>
                                          <select className={selectInput} value={String(line.accountId)} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({
                                            ...transaction,
                                            journalLines: transaction.journalLines.map((current, currentIndex) => currentIndex === index ? { ...current, accountId: Number(event.target.value) } : current),
                                          }))}>
                                            <option value="0">Account…</option>
                                            {accounts.map((account) => (
                                              <option key={account.accountId} value={account.accountId}>{account.accountNumber} — {account.accountName}</option>
                                            ))}
                                          </select>
                                          <input className={input} value={line.amount} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({
                                            ...transaction,
                                            journalLines: transaction.journalLines.map((current, currentIndex) => currentIndex === index ? { ...current, amount: event.target.value } : current),
                                          }))} />
                                          <select className={selectInput} value={line.currency} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({
                                            ...transaction,
                                            journalLines: transaction.journalLines.map((current, currentIndex) => currentIndex === index ? { ...current, currency: event.target.value } : current),
                                          }))}>
                                            <option value="CAD">CAD</option>
                                            <option value="USD">USD</option>
                                            <option value="CNY">CNY</option>
                                          </select>
                                          <input className={input} value={line.memo ?? ""} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({
                                            ...transaction,
                                            journalLines: transaction.journalLines.map((current, currentIndex) => currentIndex === index ? { ...current, memo: event.target.value } : current),
                                          }))} />
                                          <button type="button" className="rounded-md border border-zinc-200 text-zinc-500 hover:bg-white" onClick={() => updateTransactionField(item.itemId, (transaction) => ({
                                            ...transaction,
                                            journalLines: transaction.journalLines.filter((_, currentIndex) => currentIndex !== index),
                                          }))}>×</button>
                                        </div>
                                      ))}
                                      <button type="button" className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] hover:bg-white" onClick={() => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, journalLines: [...transaction.journalLines, emptyLine()] }))}>
                                        Add line
                                      </button>
                                    </div>
                                  </div>
                                  <div className="space-y-3">
                                    <div>
                                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Notes</div>
                                      <textarea className={`${input} min-h-[90px]`} value={tx.notes ?? ""} onChange={(event) => updateTransactionField(item.itemId, (transaction) => ({ ...transaction, notes: event.target.value }))} />
                                    </div>
                                    {item.warningsJson?.length ? (
                                      <div>
                                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Warnings</div>
                                        <ul className="space-y-1 text-[11px] text-amber-700">
                                          {item.warningsJson.map((warning) => <li key={warning}>• {warning}</li>)}
                                        </ul>
                                      </div>
                                    ) : null}
                                    {item.ocrRawText ? (
                                      <div>
                                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Raw OCR</div>
                                        <pre className="max-h-40 overflow-auto rounded-md border border-zinc-200 bg-white p-2 text-[11px] text-zinc-600 whitespace-pre-wrap">{item.ocrRawText}</pre>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
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
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium ${styles[item.colorState]}`}>
      <Icon className="h-3 w-3" /> {item.status.replace(/_/g, " ")}
    </span>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "neutral" | "green" | "yellow" | "red" }) {
  const toneMap = {
    neutral: "border-zinc-200 bg-white text-zinc-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    yellow: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
  };
  return (
    <div className={`rounded-lg border px-3 py-3 ${toneMap[tone]}`}>
      <div className="text-xs uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
