import { installContentScript } from "@ironkeep/extension-ui/content";

declare const browser: {
  runtime: {
    onMessage: {
      addListener(listener: (rawMessage: unknown) => void): void;
    };
  };
};

installContentScript((listener) => browser.runtime.onMessage.addListener(listener));
