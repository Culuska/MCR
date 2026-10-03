import type { Tx } from "@/lib/db";

// Gap-free document numbers (EXP-00001). Must run inside the transaction that uses the number.
export async function nextNumber(tx: Tx, key: "EXP" | "INV" | "JE" | "PAY" | "REC" | "EMP" | "ADV" | "PRN" | "AST" | "RNT" | "MAT" | "PO" | "GRN" | "SUB" | "CRT" | "RET" | "TSK" | "ISS"): Promise<string> {
  const row = await tx.sequence.upsert({
    where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } },
  });
  return `${key}-${String(row.value).padStart(5, "0")}`;
}
