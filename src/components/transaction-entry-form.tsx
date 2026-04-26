"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, Upload, X, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import {
  type TransactionInput,
  transactionInputSchema,
} from "@/lib/validation/transaction";

const input =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400";
const label = "mb-1.5 block text-xs font-medium text-zinc-500 uppercase tracking-wide";

type AccountOption = {
  accountId: number;
  accountNumber: string;
  accountName: string;
  accountType: string;
  currency: string;
};

type TypeOption = {
  typeId: number;
  typeName: string;
  description: string | null;
};

const defaults: TransactionInput = {
  transactId: "",
  transactDate: new Date().toISOString().slice(0, 10),
  typeId: 1,
  description: "",
  totalAmount: "",
  currency: "CAD",
  exchangeRate: "",
  receiptRef: "",
  notes: "",
  journalLines: [
    { drCr: "DR", accountId: 0, amount: "", currency: "CAD", amountCad: "", memo: "" },
    { drCr: "CR", accountId: 0, amount: "", currency: "CAD", amountCad: "", memo: "" },
  ],
};

export function TransactionEntryForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setAccounts(d); }).catch(() => {});
    fetch("/api/transaction-types").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setTypes(d); }).catch(() => {});
  }, []);

  const {
    control,
    formState: { errors, isSubmitting },
    getValues,
    handleSubmit,
    register,
    reset,
    setValue,
  } = useForm<TransactionInput>({
    resolver: zodResolver(transactionInputSchema),
    defaultValues: defaults,
  });

  const lines = useFieldArray({ control, name: "journalLines" });

  const watchedLines = useWatch({ control, name: "journalLines", defaultValue: defaults.journalLines });
  const totals = useMemo(() => {
    return watchedLines.reduce(
      (acc, l) => {
        const n = Number(l.amount || 0);
        if (!Number.isNaN(n)) l.drCr === "DR" ? (acc.dr += n) : (acc.cr += n);
        return acc;
      },
      { dr: 0, cr: 0 },
    );
  }, [watchedLines]);

  const balanced = Math.abs(totals.dr - totals.cr) < 0.001;

  const handleFileUpload = useCallback(async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("transactionId", getValues("transactId") || "draft");

      const res = await fetch("/api/upload-receipt", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (!res.ok) {
        setUploadError(result.error ?? "Upload failed");
        return;
      }

      setUploadedFile({ name: file.name, url: result.url });
      // Store the serving URL in the receiptRef field
      setValue("receiptRef", result.url);
    } catch {
      setUploadError("Upload failed — check your connection");
    } finally {
      setUploading(false);
    }
  }, [getValues, setValue]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
      // Reset so the same file can be re-selected
      e.target.value = "";
    },
    [handleFileUpload],
  );

  const removeFile = useCallback(() => {
    setUploadedFile(null);
    setValue("receiptRef", "");
  }, [setValue]);

  const onSubmit = async (values: TransactionInput) => {
    setSubmitError(null);
    setSubmitSuccess(null);

    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    const result = (await res.json().catch(() => null)) as { error?: string; transactId?: string } | null;

    if (!res.ok) {
      setSubmitError(result?.error ?? "Failed to save.");
      return;
    }

    setSubmitSuccess(`Saved ${result?.transactId}`);
    setUploadedFile(null);
    reset({ ...defaults, transactDate: values.transactDate, typeId: values.typeId, currency: values.currency });
    router.refresh();
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
      {/* -- Header -- */}
      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-zinc-950">Header</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={label}>Transaction ID</label>
            <input className={input} placeholder="2026-03-06-1" {...register("transactId")} />
            {errors.transactId && <p className="mt-1 text-xs text-red-600">{errors.transactId.message}</p>}
          </div>
          <div>
            <label className={label}>Date</label>
            <input className={input} type="date" {...register("transactDate")} />
          </div>
          <div>
            <label className={label}>Type</label>
            <select className={input} {...register("typeId", { valueAsNumber: true })}>
              {types.map((t) => (
                <option key={t.typeId} value={t.typeId}>{t.typeName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Total amount</label>
            <input className={input} placeholder="800.00" {...register("totalAmount")} />
            {errors.totalAmount && <p className="mt-1 text-xs text-red-600">{errors.totalAmount.message}</p>}
          </div>
          <div>
            <label className={label}>Currency</label>
            <select className={input} {...register("currency")}>
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
              <option value="CNY">CNY</option>
            </select>
          </div>
          <div>
            <label className={label}>Exchange rate</label>
            <input className={input} placeholder="e.g. 1.365000" {...register("exchangeRate")} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={label}>Description</label>
            <input className={input} placeholder="WIRE TSF 0026467 — Dadi Trading" {...register("description")} />
            {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>}
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <label className={label}>Receipt</label>
            <input type="hidden" {...register("receiptRef")} />
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={handleFileSelect}
            />
            {uploadedFile ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-emerald-600" />
                <a
                  href={uploadedFile.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate text-emerald-700 underline"
                >
                  {uploadedFile.name}
                </a>
                <button
                  type="button"
                  className="ml-auto shrink-0 text-zinc-400 hover:text-red-600"
                  onClick={removeFile}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-2 text-sm transition-colors ${
                  dragOver
                    ? "border-zinc-400 bg-zinc-100"
                    : "border-zinc-200 bg-white hover:border-zinc-300"
                } ${uploading ? "pointer-events-none opacity-50" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 text-zinc-400" />
                <span className="text-zinc-500">
                  {uploading ? "Uploading…" : "Drop file or click"}
                </span>
              </div>
            )}
            {uploadError && <p className="mt-1 text-xs text-red-600">{uploadError}</p>}
          </div>
          <div className="sm:col-span-1 lg:col-span-2">
            <label className={label}>Notes</label>
            <input className={input} placeholder="Internal notes" {...register("notes")} />
          </div>
        </div>
      </section>

      {/* -- Journal lines -- */}
      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-950">Journal lines</h2>
          <div className="flex items-center gap-4 text-sm tabular-nums">
            <span className="text-zinc-500">
              DR <strong className="text-zinc-950">{totals.dr.toFixed(2)}</strong>
            </span>
            <span className="text-zinc-500">
              CR <strong className="text-zinc-950">{totals.cr.toFixed(2)}</strong>
            </span>
            <span className={balanced ? "font-medium text-emerald-600" : "font-medium text-red-600"}>
              {balanced ? "Balanced" : `Diff ${(totals.dr - totals.cr).toFixed(2)}`}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          {lines.fields.map((field, i) => (
            <div
              key={field.id}
              className="grid items-start gap-2 rounded-lg border border-zinc-100 bg-zinc-50 p-3 sm:grid-cols-[80px_1fr_120px_90px_120px_1fr_36px]"
            >
              <select className={input} {...register(`journalLines.${i}.drCr`)}>
                <option value="DR">DR</option>
                <option value="CR">CR</option>
              </select>
              <select className={input} {...register(`journalLines.${i}.accountId`, { valueAsNumber: true })}>
                <option value={0}>Account…</option>
                {accounts.map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.accountNumber} — {a.accountName}
                  </option>
                ))}
              </select>
              <input className={input} placeholder="Amount" {...register(`journalLines.${i}.amount`)} />
              <select className={input} {...register(`journalLines.${i}.currency`)}>
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
              </select>
              <input className={input} placeholder="CAD equiv." {...register(`journalLines.${i}.amountCad`)} />
              <input className={input} placeholder="Memo" {...register(`journalLines.${i}.memo`)} />
              <button
                type="button"
                className="flex h-[38px] items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 hover:border-red-200 hover:text-red-600 disabled:opacity-30"
                onClick={() => lines.remove(i)}
                disabled={lines.fields.length <= 2}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-950"
          onClick={() =>
            lines.append({
              drCr: "DR",
              accountId: 0,
              amount: "",
              currency: getValues("currency"),
              amountCad: "",
              memo: "",
            })
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add line
        </button>

        {errors.journalLines && (
          <p className="mt-3 text-xs text-red-600">
            {typeof errors.journalLines === "object" && "message" in errors.journalLines
              ? (errors.journalLines.message as string)
              : "Check journal lines"}
          </p>
        )}
      </section>

      {/* -- Submit -- */}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          className="rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving…" : "Save transaction"}
        </button>
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        {submitSuccess && <p className="text-sm text-emerald-600">{submitSuccess}</p>}
      </div>
    </form>
  );
}
