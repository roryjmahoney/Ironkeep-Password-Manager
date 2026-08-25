import { installContentScript } from "@ironkeep/extension-ui/content";

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(listener: (rawMessage: unknown) => void): void;
    };
  };
};

installContentScript({
  addMessageListener: (listener) => chrome.runtime.onMessage.addListener(listener),
  sendMessage: (message) => chrome.runtime.sendMessage(message) as never,
});
