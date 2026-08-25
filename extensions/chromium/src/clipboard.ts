import { shouldClearClipboard } from "@ironkeep/shared";

interface ClipboardWriteMessage {
  type: "IRONKEEP_CLIPBOARD_WRITE";
  value: string;
  clearAfterSeconds: number;
}

interface ClipboardClearMessage {
  type: "IRONKEEP_CLIPBOARD_CLEAR_NOW";
}

type ClipboardMessage = ClipboardWriteMessage | ClipboardClearMessage;

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(
        listener: (
          rawMessage: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean,
      ): void;
    };
  };
};

let generation = 0;
let expectedValue: string | null = null;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

async function clearOwned(currentGeneration: number): Promise<void> {
  if (currentGeneration !== generation || expectedValue === null) return;
  if (clearTimer !== null) clearTimeout(clearTimer);
  clearTimer = null;
  const expected = expectedValue;
  expectedValue = null;
  try {
    const current = await navigator.clipboard.readText();
    if (shouldClearClipboard(expected, current)) await navigator.clipboard.writeText("");
  } finally {
    expectedValue = null;
    void chrome.runtime.sendMessage({ type: "IRONKEEP_CLIPBOARD_FINISHED" });
  }
}

chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
  if (!rawMessage || typeof rawMessage !== "object" || !("type" in rawMessage)) return false;
  if (rawMessage.type !== "IRONKEEP_CLIPBOARD_WRITE" && rawMessage.type !== "IRONKEEP_CLIPBOARD_CLEAR_NOW") return false;
  const message = rawMessage as ClipboardMessage;
  void (async () => {
    if (message.type === "IRONKEEP_CLIPBOARD_WRITE") {
      const currentGeneration = ++generation;
      if (!message.value || !Number.isInteger(message.clearAfterSeconds)) throw new Error("Invalid clipboard request");
      await navigator.clipboard.writeText(message.value);
      expectedValue = message.value;
      if (clearTimer !== null) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => { void clearOwned(currentGeneration); }, message.clearAfterSeconds * 1_000);
    } else {
      await clearOwned(generation);
    }
    sendResponse({ ok: true });
  })().catch(() => sendResponse({ ok: false }));
  return true;
});
