import { z } from "zod";
import { ActionError } from "@/lib/errors";

// What a form's server action hands back to the page. `ok` carries an optional message.
export type FormState = { error?: string; ok?: string } | undefined;

// Runs an action body and turns validation/permission problems into a message for the form.
export async function run(body: () => Promise<string | void>): Promise<FormState> {
  try {
    const ok = await body();
    return { ok: ok ?? "Saved" };
  } catch (e) {
    if (e instanceof ActionError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" ") };
    // Next's redirect() throws a special error; it must keep travelling.
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error(e);
    return { error: "Something went wrong and nothing was saved. Try again." };
  }
}

export const optionalText = z.string().trim().transform((v) => (v === "" ? null : v)).nullable().optional();
export const money = z.coerce.number({ error: "Enter an amount." }).positive("Amount must be more than zero.").max(1e9, "Amount is too large.");
export const date = z.coerce.date({ error: "Enter a valid date." });

export const optionalDate = z.union([z.literal(""), date]).transform((v) => (v === "" ? null : v)).optional();
export const optionalAmount = z.union([z.literal(""), z.coerce.number().min(0, "Amounts cannot be negative.").max(1e9)]).transform((v) => (v === "" ? null : v)).optional();

export const formObject = (fd: FormData) => Object.fromEntries(fd.entries());
