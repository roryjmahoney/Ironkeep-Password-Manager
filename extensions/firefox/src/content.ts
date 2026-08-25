import { installContentScript } from "@ironkeep/extension-ui/content";

declare const browser: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(listener: (rawMessage: unknown) => void): void;
    };
  };
};

installContentScript({
  addMessageListener: (listener) => browser.runtime.onMessage.addListener(listener),
  sendMessage: (message) => browser.runtime.sendMessage(message) as never,
});
