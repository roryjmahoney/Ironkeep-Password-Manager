import {
  detectCapturedCredential,
  generatePassword,
  type BrowserFormFieldSnapshot,
} from "@ironkeep/shared";
import type { ContentRequest, ContentResponse, PublicCapturePrompt } from "./types.js";

interface FillMessage {
  type: "IRONKEEP_FILL";
  username: string;
  password: string;
}

interface ContentRuntime {
  addMessageListener(listener: (rawMessage: unknown) => void): void;
  sendMessage(request: ContentRequest): Promise<ContentResponse>;
}

const PANEL_STYLES = `
  :host { all: initial; color-scheme: light dark; }
  * { box-sizing: border-box; }
  .panel { position: fixed; z-index: 2147483647; right: 20px; bottom: 20px; width: min(360px, calc(100vw - 32px)); border: 1px solid #8d744b; background: #171714; color: #f7f2e8; padding: 18px; box-shadow: 0 18px 50px rgba(0,0,0,.45); font: 14px/1.5 system-ui, sans-serif; }
  .eyebrow { margin: 0 0 6px; color: #c9a96e; font-size: 10px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
  h2 { margin: 0; color: #fffaf0; font: 600 24px/1.1 Georgia, serif; }
  p { margin: 10px 0 0; color: #d4cec1; overflow-wrap: anywhere; }
  .origin { color: #c9a96e; font-size: 12px; }
  label { display: block; margin-top: 14px; color: #d4cec1; font-size: 12px; font-weight: 700; }
  select { width: 100%; min-height: 44px; margin-top: 6px; border: 1px solid #655b4a; border-radius: 0; background: #24231f; color: #fffaf0; padding: 8px 10px; font: inherit; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  button { min-height: 44px; border: 1px solid #8d744b; border-radius: 0; background: transparent; color: #f7f2e8; padding: 9px 12px; font: 700 13px/1 system-ui, sans-serif; cursor: pointer; }
  button.primary { background: #b58b4c; color: #16140f; }
  button:disabled { cursor: default; opacity: .45; }
  button:focus-visible, select:focus-visible { outline: 3px solid #e8c98c; outline-offset: 2px; }
  .status { min-height: 21px; color: #efc27e; font-size: 12px; }
  @media (max-width: 420px) { .panel { right: 16px; bottom: 16px; } }
`;

let activeHost: HTMLElement | null = null;
let activeCaptureId: string | null = null;
let activeCaptureRuntime: ContentRuntime | null = null;
let returnFocus: HTMLElement | null = null;
const offeredGeneratorFields = new WeakSet<HTMLInputElement>();

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: value }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function visible(input: HTMLInputElement): boolean {
  const rect = input.getBoundingClientRect();
  const style = getComputedStyle(input);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function candidateInputs(): { username?: HTMLInputElement; password?: HTMLInputElement } {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input")].filter(visible);
  const password = inputs.find((input) => input.type === "password" && !input.disabled && !input.readOnly);
  const username = inputs.find((input) =>
    input !== password &&
    !input.disabled &&
    !input.readOnly &&
    (input.autocomplete === "username" || input.type === "email" || /user|email|login/i.test(`${input.name} ${input.id}`)),
  );
  return { ...(username ? { username } : {}), ...(password ? { password } : {}) };
}

function dismissPanel(notifyCapture = false): void {
  const captureId = activeCaptureId;
  const runtime = activeCaptureRuntime;
  activeHost?.remove();
  activeHost = null;
  activeCaptureId = null;
  activeCaptureRuntime = null;
  if (returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
  if (notifyCapture && captureId && runtime) {
    void runtime.sendMessage({ type: "DISMISS_CAPTURE", captureId }).catch(() => undefined);
  }
}

function panel(title: string, description: string): { body: HTMLElement; status: HTMLElement; firstButton: (label: string, primary?: boolean) => HTMLButtonElement } {
  dismissPanel();
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const host = document.createElement("div");
  host.dataset.ironkeepPrompt = "true";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = PANEL_STYLES;
  const body = document.createElement("section");
  body.className = "panel";
  body.setAttribute("role", "dialog");
  body.setAttribute("aria-modal", "false");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Ironkeep";
  const heading = document.createElement("h2");
  heading.id = `ironkeep-${crypto.randomUUID()}`;
  heading.textContent = title;
  body.setAttribute("aria-labelledby", heading.id);
  const copy = document.createElement("p");
  copy.textContent = description;
  const status = document.createElement("p");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  body.append(eyebrow, heading, copy, status);
  shadow.append(style, body);
  document.documentElement.append(host);
  activeHost = host;
  return {
    body,
    status,
    firstButton(label: string, primary = false) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (primary) button.className = "primary";
      return button;
    },
  };
}

function actionRow(body: HTMLElement): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "actions";
  body.append(actions);
  return actions;
}

function showNotice(title: string, description: string): void {
  const view = panel(title, description);
  const actions = actionRow(view.body);
  const close = view.firstButton("Not now", true);
  close.addEventListener("click", () => dismissPanel());
  actions.append(close);
  close.focus();
}

function snapshot(form: HTMLFormElement): BrowserFormFieldSnapshot[] {
  return [...form.querySelectorAll<HTMLInputElement>("input")].filter(visible).map((input) => ({
    type: input.type,
    autocomplete: input.autocomplete,
    name: input.name,
    id: input.id,
    value: input.value,
    disabled: input.disabled,
    readOnly: input.readOnly,
  }));
}

function generatorTargets(input: HTMLInputElement): HTMLInputElement[] {
  const form = input.form;
  if (!form) return [input];
  const passwords = [...form.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter((candidate) => !candidate.disabled && !candidate.readOnly);
  const explicit = passwords.filter((candidate) => candidate.autocomplete.toLowerCase() === "new-password" || /new|confirm|repeat/i.test(`${candidate.name} ${candidate.id}`));
  return explicit.length ? explicit : [input];
}

function offerGeneratedPassword(input: HTMLInputElement): void {
  if (activeCaptureId || offeredGeneratorFields.has(input)) return;
  const identity = `${input.autocomplete} ${input.name} ${input.id}`.toLowerCase();
  if (input.autocomplete.toLowerCase() !== "new-password" && !/new|confirm|repeat/u.test(identity)) return;
  offeredGeneratorFields.add(input);
  const view = panel("Use a strong password?", "Generate locally and fill this form. Ironkeep never submits the form for you.");
  const actions = actionRow(view.body);
  const use = view.firstButton("Use generated password", true);
  const dismiss = view.firstButton("Not now");
  use.addEventListener("click", () => {
    const generated = generatePassword({ length: 20 });
    for (const target of generatorTargets(input)) setNativeInputValue(target, generated);
    dismissPanel();
    input.focus();
  });
  dismiss.addEventListener("click", () => dismissPanel());
  actions.append(use, dismiss);
}

function showCapturePrompt(runtime: ContentRuntime, prompt: PublicCapturePrompt): void {
  const view = panel("Save this login?", "Review the verified site and identifier. The password stays hidden.");
  activeCaptureId = prompt.id;
  activeCaptureRuntime = runtime;
  const origin = document.createElement("p");
  origin.className = "origin";
  origin.textContent = prompt.origin;
  view.body.insertBefore(origin, view.status);
  const proposedTitle = document.createElement("p");
  proposedTitle.textContent = `Login name: ${prompt.title}`;
  view.body.insertBefore(proposedTitle, view.status);
  const identifier = document.createElement("p");
  identifier.textContent = prompt.username ? `Identifier: ${prompt.username}` : "No identifier was detected.";
  view.body.insertBefore(identifier, view.status);

  let selectedItemId = prompt.suggestedItemId ?? prompt.matches[0]?.id;
  if (prompt.matches.length) {
    const label = document.createElement("label");
    label.textContent = "Existing login to update";
    const select = document.createElement("select");
    for (const match of prompt.matches) {
      const option = document.createElement("option");
      option.value = match.id;
      option.textContent = `${match.title} · ${match.subtitle}`;
      option.selected = match.id === selectedItemId;
      select.append(option);
    }
    select.addEventListener("change", () => { selectedItemId = select.value; });
    label.append(select);
    view.body.insertBefore(label, view.status);
  }

  const actions = actionRow(view.body);
  const saveNew = view.firstButton("Save as new login", prompt.suggestedAction === "create");
  const update = view.firstButton("Update existing login", prompt.suggestedAction === "update");
  const dismiss = view.firstButton("Not now");
  update.disabled = !selectedItemId;

  const setBusy = (busy: boolean) => {
    saveNew.disabled = busy;
    update.disabled = busy || !selectedItemId;
    dismiss.disabled = busy;
  };
  const commit = async (action: "create" | "update", confirmDuplicate = false) => {
    setBusy(true);
    view.status.textContent = "Encrypting and saving…";
    try {
      const response = await runtime.sendMessage({
        type: "COMMIT_CAPTURE",
        captureId: prompt.id,
        action,
        ...(action === "update" && selectedItemId ? { itemId: selectedItemId } : {}),
        confirmDuplicate,
      });
      if (response.ok && "captureStatus" in response && response.captureStatus === "saved") {
        view.status.textContent = "Saved to the encrypted vault.";
        saveNew.remove();
        update.remove();
        dismiss.textContent = "Close";
        window.setTimeout(dismissPanel, 3_000);
        return;
      }
      if (!response.ok && response.error === "DUPLICATE") {
        view.status.textContent = `Likely duplicate: ${response.items.map((item) => item.title).join(", ")}.`;
        const confirm = view.firstButton(action === "create" ? "Save as new anyway" : "Update anyway", true);
        confirm.addEventListener("click", () => { confirm.remove(); void commit(action, true); });
        actions.prepend(confirm);
      } else if (!response.ok && response.error === "LOCKED") {
        view.status.textContent = "Vault locked. Unlock Ironkeep, then submit the form again.";
      } else if (!response.ok && response.error === "PERSISTENCE_FAILED") {
        view.status.textContent = "Encrypted save failed. The previous vault is intact. Try again.";
      } else {
        view.status.textContent = "This save request expired. Submit the form again.";
      }
    } finally {
      setBusy(false);
    }
  };
  saveNew.addEventListener("click", () => { void commit("create"); });
  update.addEventListener("click", () => { void commit("update"); });
  dismiss.addEventListener("click", () => {
    void runtime.sendMessage({ type: "DISMISS_CAPTURE", captureId: prompt.id });
    dismissPanel();
  });
  actions.append(saveNew, update, dismiss);
  (prompt.suggestedAction === "update" && selectedItemId ? update : saveNew).focus();
}

async function submitCapture(runtime: ContentRuntime, form: HTMLFormElement): Promise<void> {
  if (location.protocol !== "https:") return;
  const credential = detectCapturedCredential(snapshot(form), location.origin);
  if (!credential) return;
  try {
    const response = await runtime.sendMessage({ type: "CAPTURE_CREDENTIAL", credential });
    credential.password = "";
    credential.username = "";
    if (response.ok && "capture" in response && response.capture) showCapturePrompt(runtime, response.capture);
    else if (!response.ok && response.error === "LOCKED") showNotice("Unlock Ironkeep to save", "Open Ironkeep from the toolbar, unlock locally, then submit this form again.");
  } catch {
    credential.password = "";
    credential.username = "";
  }
}

export function installContentScript(runtime: ContentRuntime): void {
  runtime.addMessageListener((rawMessage: unknown) => {
    if (!rawMessage || typeof rawMessage !== "object" || !("type" in rawMessage) || rawMessage.type !== "IRONKEEP_FILL") return;
    const message = rawMessage as FillMessage;
    const { username, password } = candidateInputs();
    if (username && message.username) setNativeInputValue(username, message.username);
    if (password && message.password) setNativeInputValue(password, message.password);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeHost) dismissPanel(true);
  });

  if (location.protocol === "https:") {
    document.addEventListener("focusin", (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.type === "password" && !input.disabled && !input.readOnly) offerGeneratedPassword(input);
    });
    document.addEventListener("submit", (event) => {
      if (event.target instanceof HTMLFormElement) void submitCapture(runtime, event.target);
    }, true);
    void runtime.sendMessage({ type: "GET_PENDING_CAPTURE" }).then((response) => {
      if (response.ok && "capture" in response && response.capture) showCapturePrompt(runtime, response.capture);
    }).catch(() => undefined);
  }
}
