const assert = require("node:assert/strict");
const manifest = require("../package.json");

const extensionId = `${manifest.publisher}.${manifest.name}`;

assert.ok(
  Array.isArray(manifest.extensionKind) &&
    manifest.extensionKind.includes("workspace"),
  `${extensionId} must support the workspace Extension Host so it can load from Remote-SSH, WSL, and Dev Container workspaces.`,
);

assert.deepEqual(
  manifest.extensionDependencies,
  ["cooronx.leetdock-auth"],
  `${extensionId} must require its local network companion.`,
);

console.log(`${extensionId} supports the workspace Extension Host.`);
