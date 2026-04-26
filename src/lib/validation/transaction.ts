import { z } from "zod";

const moneyString = z
  .string()
  .trim()
  .min(1, "Amount is required")
  .refine((value) => /^-?\d+(\.\d{1,2})?$/.test(value), "Use a numeric amount like 206.04");

export const sourceLineSchema = z.object({
  lineDate: z.string().optional(),
  lineType: z.string().trim().optional(),
  lineAmount: z.string().trim().optional(),
  currencyCode: z.string().trim().length(3),
  lineDescription: z.string().trim().optional(),
});

export const journalEntrySchema = z.object({
  side: z.enum(["DR", "CR"]),
  accountName: z.string().trim().min(1, "Account is required"),
  amount: moneyString,
  currencyCode: z.string().trim().length(3),
  memo: z.string().trim().optional(),
});

export const transactionDraftSchema = z
  .object({
    transactionDate: z.string().min(1, "Transaction date is required"),
    transactionType: z.string().trim().min(1, "Transaction type is required"),
    summaryAmount: z.string().trim().optional(),
    currencyCode: z.string().trim().length(3),
    summaryDescription: z.string().trim().optional(),
    receiptDate: z.string().optional(),
    notes: z.string().trim().optional(),
    sourceLines: z.array(sourceLineSchema),
    journalEntries: z.array(journalEntrySchema).min(2, "At least two journal entries are required"),
  })
  .superRefine((value, ctx) => {
    const totals = value.journalEntries.reduce(
      (acc, entry) => {
        const numericAmount = Number(entry.amount);
        if (Number.isNaN(numericAmount)) {
          return acc;
        }

        if (entry.side === "DR") {
          acc.dr += numericAmount;
        } else {
          acc.cr += numericAmount;
        }

        return acc;
      },
      { dr: 0, cr: 0 },
    );

    if (Math.abs(totals.dr - totals.cr) > 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Debit and credit totals must balance",
        path: ["journalEntries"],
      });
    }
  });

export type TransactionDraftInput = z.infer<typeof transactionDraftSchema>;
