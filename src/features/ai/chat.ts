/**
 * 18 T-3 — the staff enquiry chatbot (FR-2/3, AC-3/10). NOT "use server":
 * exported for the /api/ai/chat route and for tests with explicit claims.
 *
 * Staff-only, `ai:use`-gated, read-only tool-use. The bot may look things up
 * with the caller's own scope, but it cannot mutate anything — no mutation tool
 * is exposed — and it cannot confirm a booking (that is the normal server flow).
 * There is NO public/anonymous entry point here; the guest-site chatbot is 23.
 */
import { authorize } from "@/lib/permissions";
import { getLLMProvider, redactText } from "@/lib/ai";
import type { Msg } from "@/lib/ai";
import type { SessionClaims } from "@/lib/auth/claims";
import { READ_ONLY_TOOL_SPECS, executeTool } from "./tools";
import { logInteraction } from "./internal";

const SYSTEM = [
  "You are the staff assistant for a hotel PMS. Answer using ONLY the read-only tools provided.",
  "You cannot change any data or confirm bookings; direct the user to the proper screen for that.",
  "Never reveal another guest's personal details.",
].join(" ");

export type ChatResult = {
  answer: string;
  usedTools: string[];
};

/** One turn of tool-augmented chat. Requires `ai:use`. */
export async function chat(user: SessionClaims, input: { message: string }): Promise<ChatResult> {
  authorize(user, "ai:use");

  const provider = getLLMProvider();
  const messages: Msg[] = [{ role: "user", content: redactText(input.message) }];
  const usedTools: string[] = [];

  const first = await provider.complete({
    system: SYSTEM,
    messages,
    tools: [...READ_ONLY_TOOL_SPECS],
    feature: "chatbot",
  });

  let answer = first.text;

  if (first.toolCalls.length > 0) {
    // Execute each proposed read-only tool with the caller's scope, then let the
    // model phrase the result. An unknown/mutating tool name throws in executeTool.
    for (const call of first.toolCalls) {
      const output = await executeTool(user, call.name, call.arguments);
      usedTools.push(call.name);
      messages.push({ role: "assistant", content: "", name: call.name, toolCallId: call.id });
      messages.push({ role: "tool", content: output, name: call.name, toolCallId: call.id });
    }
    const second = await provider.complete({
      system: SYSTEM,
      messages,
      tools: [...READ_ONLY_TOOL_SPECS],
      feature: "chatbot",
    });
    answer = second.text;
  }

  await logInteraction({
    userId: user.userId,
    feature: "chatbot",
    provider: first.provider,
    rawInput: { message: input.message },
    outputRef: usedTools.length ? `tools:${usedTools.join(",")}` : "no-tool",
  });

  return { answer, usedTools };
}
