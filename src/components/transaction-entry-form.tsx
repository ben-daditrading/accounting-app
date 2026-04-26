"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ChangeEvent, useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import {
  type TransactionDraftInput,
  transactionDraftSchema,
} from "@/lib/validation/transaction";

const inputClassName =
  "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400";
const labelClassName = "mb-2 block text-sm font-medium text-zinc-700";
const sectionClassName = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";

const defaultValues: TransactionDraftInput = {
  transactionDate: new Date().toISOString().slice(0, 10),
  transactionType: "Expense",
  summaryAmount: "",
  currencyCode: "CAD",
  summaryDescription: "",
  receiptDate: "",
  notes: "",
  sourceLines: [
    {
      lineDate: new Date().toISOString().slice(0, 10),
      lineType: "Expense",
      lineAmount: "",
      currencyCode: "CAD",
      lineDescription: "",
    },
  ],
  journalEntries: [
    { side: "DR", accountName: "", amount: "", currencyCode: "CAD", memo: "" },
    { side: "CR", accountName: "", amount: "", currencyCode: "CAD", memo: "" },
  ],
};

export function TransactionEntryForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const {
    control,
    formState: { errors, isSubmitting },
    getValues,
    handleSubmit,
    register,
    reset,
  } = useForm<TransactionDraftInput>({
    resolver: zodResolver(transactionDraftSchema),
    defaultValues,
  });

  const sourceLines = useFieldArray({
    control,
    name: "sourceLines",
  });

  const journalEntries = useFieldArray({
    control,
    name: "journalEntries",
  });

  const watchedEntries = useWatch({
    control,
    name: "journalEntries",
    defaultValue: defaultValues.journalEntries,
  });
  const totals = useMemo(() => {
    return watchedEntries.reduce(
      (acc, entry) => {
        const amount = Number(entry.amount || 0);
        if (Number.isNaN(amount)) {
          return acc;
        }

        if (entry.side === "DR") {
          acc.dr += amount;
        } else {
          acc.cr += amount;
        }

        return acc;
      },
      { dr: 0, cr: 0 },
    );
  }, [watchedEntries]);

  function handleReceiptChange(event: ChangeEvent<HTMLInputElement>) {
    setReceiptFile(event.target.files?.[0] ?? null);
  }

  const onSubmit = async (values: TransactionDraftInput) => {
    setSubmitError(null);
    setSubmitSuccess(null);

    const response = await fetch("/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(values),
    });

    const result = (await response.json().catch(() => null)) as { error?: string; transactionId?: string } | null;

    if (!response.ok) {
      setSubmitError(result?.error ?? "Something went wrong while saving the transaction draft.");
      return;
    }

    if (receiptFile && result?.transactionId) {
      const receiptFormData = new FormData();
      receiptFormData.append("receipt", receiptFile);

      const uploadResponse = await fetch(`/api/transactions/${result.transactionId}/receipt`, {
        method: "POST",
        body: receiptFormData,
      });

      const uploadResult = (await uploadResponse.json().catch(() => null)) as { error?: string } | null;
      if (!uploadResponse.ok) {
        setSubmitError(uploadResult?.error ?? "Transaction saved, but receipt upload failed.");
        return;
      }
    }

    setSubmitSuccess("Draft transaction saved.");
    reset({
      ...defaultValues,
      transactionDate: values.transactionDate,
      transactionType: values.transactionType,
      currencyCode: values.currencyCode,
      receiptDate: values.receiptDate,
    });
    setReceiptFile(null);
    router.refresh();
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
      <section className={sectionClassName}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Transaction header</h2>
            <p className="text-sm text-zinc-500">This is the logical transaction record.</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            Prototype v1
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelClassName}>Transaction date</label>
            <input className={inputClassName} type="date" {...register("transactionDate")} />
            {errors.transactionDate ? <p className="mt-1 text-sm text-red-600">{errors.transactionDate.message}</p> : null}
          </div>
          <div>
            <label className={labelClassName}>Transaction type</label>
            <input className={inputClassName} placeholder="Expense, Deposit, Payment..." {...register("transactionType")} />
            {errors.transactionType ? <p className="mt-1 text-sm text-red-600">{errors.transactionType.message}</p> : null}
          </div>
          <div>
            <label className={labelClassName}>Summary amount</label>
            <input className={inputClassName} placeholder="206.04" {...register("summaryAmount")} />
          </div>
          <div>
            <label className={labelClassName}>Currency</label>
            <select className={inputClassName} {...register("currencyCode")}>
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
              <option value="CNY">CNY</option>
              <option value="KRW">KRW</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={labelClassName}>Summary description</label>
            <input className={inputClassName} placeholder="Meal expense at Earls" {...register("summaryDescription")} />
          </div>
          <div>
            <label className={labelClassName}>Receipt date</label>
            <input className={inputClassName} type="date" {...register("receiptDate")} />
          </div>
          <div>
            <label className={labelClassName}>Receipt file</label>
            <input className={`${inputClassName} file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium`} type="file" accept="image/*,.pdf" onChange={handleReceiptChange} />
          </div>
          <div className="md:col-span-2">
            <label className={labelClassName}>Notes</label>
            <textarea className={`${inputClassName} min-h-24`} placeholder="Optional internal notes" {...register("notes")} />
          </div>
        </div>
      </section>

      <section className={sectionClassName}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Source lines</h2>
            <p className="text-sm text-zinc-500">Preserves the left side of the spreadsheet when one transaction spans multiple lines.</p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700"
            onClick={() =>
              sourceLines.append({
                lineDate: getValues("transactionDate"),
                lineType: getValues("transactionType"),
                lineAmount: "",
                currencyCode: getValues("currencyCode"),
                lineDescription: "",
              })
            }
          >
            <Plus className="h-4 w-4" /> Add line
          </button>
        </div>

        <div className="space-y-4">
          {sourceLines.fields.map((field, index) => (
            <div key={field.id} className="grid gap-3 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
              <input className={inputClassName} type="date" {...register(`sourceLines.${index}.lineDate`)} />
              <input className={inputClassName} placeholder="Line type" {...register(`sourceLines.${index}.lineType`)} />
              <input className={inputClassName} placeholder="Amount" {...register(`sourceLines.${index}.lineAmount`)} />
              <input className={inputClassName} placeholder="Description" {...register(`sourceLines.${index}.lineDescription`)} />
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-xl border border-red-200 px-3 py-2 text-red-600"
                onClick={() => sourceLines.remove(index)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className={sectionClassName}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Journal entries</h2>
            <p className="text-sm text-zinc-500">The debits and credits must balance before posting.</p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700"
            onClick={() => journalEntries.append({ side: "DR", accountName: "", amount: "", currencyCode: getValues("currencyCode"), memo: "" })}
          >
            <Plus className="h-4 w-4" /> Add journal line
          </button>
        </div>

        <div className="mb-4 grid gap-3 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700 md:grid-cols-3">
          <div>
            <span className="block text-xs uppercase tracking-wide text-zinc-500">Debits</span>
            <strong className="text-lg text-zinc-950">{totals.dr.toFixed(2)}</strong>
          </div>
          <div>
            <span className="block text-xs uppercase tracking-wide text-zinc-500">Credits</span>
            <strong className="text-lg text-zinc-950">{totals.cr.toFixed(2)}</strong>
          </div>
          <div>
            <span className="block text-xs uppercase tracking-wide text-zinc-500">Difference</span>
            <strong className={`text-lg ${Math.abs(totals.dr - totals.cr) < 0.001 ? "text-emerald-600" : "text-red-600"}`}>
              {(totals.dr - totals.cr).toFixed(2)}
            </strong>
          </div>
        </div>

        <div className="space-y-4">
          {journalEntries.fields.map((field, index) => (
            <div key={field.id} className="grid gap-3 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 md:grid-cols-[90px_1.3fr_140px_110px_1fr_auto]">
              <select className={inputClassName} {...register(`journalEntries.${index}.side`)}>
                <option value="DR">DR</option>
                <option value="CR">CR</option>
              </select>
              <input className={inputClassName} placeholder="Account name" {...register(`journalEntries.${index}.accountName`)} />
              <input className={inputClassName} placeholder="Amount" {...register(`journalEntries.${index}.amount`)} />
              <select className={inputClassName} {...register(`journalEntries.${index}.currencyCode`)}>
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
                <option value="KRW">KRW</option>
              </select>
              <input className={inputClassName} placeholder="Memo" {...register(`journalEntries.${index}.memo`)} />
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-xl border border-red-200 px-3 py-2 text-red-600"
                onClick={() => journalEntries.remove(index)}
                disabled={journalEntries.fields.length <= 2}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {errors.journalEntries ? <p className="mt-4 text-sm text-red-600">{errors.journalEntries.message as string}</p> : null}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        {submitError ? (
          <p className="w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </p>
        ) : null}
        {submitSuccess ? (
          <p className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {submitSuccess}
          </p>
        ) : null}
        <button
          type="submit"
          className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
          disabled={isSubmitting}
        >
          Save draft transaction
        </button>
        <p className="text-sm text-zinc-500">This now posts to the transaction API when a database is configured. Receipt upload is the next wiring step.</p>
      </div>
    </form>
  );
}
