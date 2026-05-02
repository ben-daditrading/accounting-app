import { z } from "zod";

const moneyString = z
  .string()
  .trim()
  .min(1, "Amount is required")
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), "Use a positive numeric amount like 206.04");

export const journalLineSchema = z.object({
  accountId: z.number().int().positive("Account is required"),
  accountSerial: z.string().trim().max(64).optional(),
  drCr: z.enum(["DR", "CR"]),
  amount: moneyString,
  currency: z.string().trim().length(3),
  amountCad: z.string().trim().optional(),
  memo: z.string().trim().optional(),
});

export const transactionInputSchema = z
  .object({
    transactId: z
      .string()
      .trim()
      .min(1, "Transaction ID is required")
      .max(30, "Transaction ID must be 30 characters or fewer"),
    transactDate: z.string().min(1, "Transaction date is required"),
    typeId: z.number().int().positive("Transaction type is required"),
    description: z.string().trim().min(1, "Description is required"),
    totalAmount: moneyString,
    currency: z.string().trim().length(3),
    exchangeRate: z.string().trim().optional(),
    receiptRef: z.string().trim().optional(),
    statementRef: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    journalLines: z.array(journalLineSchema).min(2, "At least two journal lines are required"),
  })
  .superRefine((value, ctx) => {
    const totals = value.journalLines.reduce(
      (acc, line) => {
        const numericAmount = Number(line.amount);
        if (Number.isNaN(numericAmount)) {
          return acc;
        }

        if (line.drCr === "DR") {
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
        path: ["journalLines"],
      });
    }
  });

export type TransactionInput = z.infer<typeof transactionInputSchema>;
