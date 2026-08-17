const assert = require("node:assert/strict");
const manifest = require("../package.json");

const extensionId = `${manifest.publisher}.${manifest.name}`;

assert.ok(
  Array.isArray(manifest.extensionKind) &&
    manifest.extensionKind.includes("workspace"),
  `${extensionId} must support the workspace Extension Host so it can load from Remote-SSH, WSL, and Dev Container workspaces.`,
);

console.log(`${extensionId} supports the workspace Extension Host.`);
