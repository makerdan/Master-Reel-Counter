export interface HelpChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Keep transcript limits aligned to complete user/assistant exchanges.
 * A trailing user message is preserved because it can be the question being
 * submitted before its assistant response has arrived.
 */
export function limitHelpChatMessages<T extends HelpChatMessage>(
  messages: T[],
  maximum: number,
): T[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new RangeError("maximum must be a positive integer");
  }
  if (messages.length <= maximum) return messages;

  let start = 0;
  while (messages.length - start > maximum) {
    if (messages[start]?.role === "user" && messages[start + 1]?.role === "assistant") {
      start += 2;
    } else {
      // Discard malformed/orphaned leading entries, never half of a valid pair.
      start += 1;
    }
  }

  return messages.slice(start);
}