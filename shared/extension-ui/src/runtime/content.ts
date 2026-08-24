interface FillMessage {
  type: "IRONKEEP_FILL";
  username: string;
  password: string;
}

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

type AddMessageListener = (listener: (rawMessage: unknown) => void) => void;

export function installContentScript(addMessageListener: AddMessageListener): void {
  addMessageListener((rawMessage: unknown) => {
    if (!rawMessage || typeof rawMessage !== "object" || !("type" in rawMessage) || rawMessage.type !== "IRONKEEP_FILL") return;
    const message = rawMessage as FillMessage;
    const { username, password } = candidateInputs();
    if (username && message.username) setNativeInputValue(username, message.username);
    if (password && message.password) setNativeInputValue(password, message.password);
  });
}
