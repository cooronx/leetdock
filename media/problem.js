(() => {
  "use strict";

  const vscode = acquireVsCodeApi();
  const supportedCommands = new Set([
    "openCode",
    "switchLanguage",
    "refresh",
    "openBrowser",
    "openExternal",
  ]);

  function postCommand(command, payload = {}) {
    if (!supportedCommands.has(command)) {
      return;
    }
    vscode.postMessage({ command, ...payload });
  }

  function asHttpsUrl(value) {
    if (typeof value !== "string") {
      return undefined;
    }

    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const link = event.target.closest("a[href]");
    if (link instanceof HTMLAnchorElement) {
      event.preventDefault();
      const href = asHttpsUrl(link.href);
      if (href !== undefined) {
        postCommand("openExternal", { href });
      }
      return;
    }

    const button = event.target.closest("button[data-command]");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const command = button.dataset.command;
    if (command !== undefined) {
      postCommand(command);
    }
  });

  if (typeof renderMathInElement === "function") {
    document.querySelectorAll(".problem-content, .hint-content").forEach((element) => {
      renderMathInElement(element, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "$", right: "$", display: false },
        ],
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
        throwOnError: false,
        strict: "ignore",
        trust: false,
      });
    });
  }
})();
