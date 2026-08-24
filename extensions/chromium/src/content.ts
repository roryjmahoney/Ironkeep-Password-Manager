import { installContentScript } from "@ironkeep/extension-ui/content";

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(listener: (rawMessage: unknown) => void): void;
    };
  };
};

installContentScript((listener) => chrome.runtime.onMessage.addListener(listener));
