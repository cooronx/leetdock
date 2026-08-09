(() => {
  "use strict";

  const vscode = acquireVsCodeApi();
  const runButton = document.getElementById("run-custom");
  const input = document.getElementById("test-input");
  if (!(runButton instanceof HTMLButtonElement) || !(input instanceof HTMLTextAreaElement)) {
    return;
  }

  runButton.addEventListener("click", () => {
    const value = input.value.trim();
    if (value.length === 0) {
      input.focus();
      return;
    }
    runButton.disabled = true;
    runButton.textContent = runButton.dataset.pendingLabel || "运行中…";
    vscode.postMessage({ command: "runCustom", input: value });
  });
})();
