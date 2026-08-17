const path = require("node:path");
const { createVSIX } = require("@vscode/vsce");

const root = path.resolve(__dirname, "..");
const companionRoot = path.join(root, "companion");
const manifest = require(path.join(companionRoot, "package.json"));
const version = process.argv[2] ?? manifest.version;
const packagePath = path.join(root, `${manifest.name}-${version}.vsix`);

createVSIX({
  cwd: companionRoot,
  version,
  packagePath,
  gitTagVersion: false,
  dependencies: false,
}).then(() => {
  console.log(`Packaged ${packagePath}`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
