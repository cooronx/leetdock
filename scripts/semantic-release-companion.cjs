const path = require("node:path");
const { createVSIX, publish } = require("@vscode/vsce");

let packagePath;

exports.prepare = async function prepareCompanion(
  _pluginConfig,
  { cwd, logger, nextRelease },
) {
  const companionRoot = path.join(cwd, "companion");
  packagePath = path.join(cwd, `leetdock-auth-${nextRelease.version}.vsix`);
  logger.log(`Packaging LeetDock local companion ${nextRelease.version}`);
  await createVSIX({
    cwd: companionRoot,
    version: nextRelease.version,
    packagePath,
    gitTagVersion: false,
    dependencies: false,
  });
};

exports.publish = async function publishCompanion(
  _pluginConfig,
  { cwd, logger, nextRelease },
) {
  if (!process.env.VSCE_PAT) {
    logger.log("Skipping local companion publish because VSCE_PAT is not set");
    return;
  }
  const companionRoot = path.join(cwd, "companion");
  const preparedPackage = packagePath ??
    path.join(cwd, `leetdock-auth-${nextRelease.version}.vsix`);
  logger.log(`Publishing LeetDock local companion ${nextRelease.version}`);
  await publish({
    cwd: companionRoot,
    pat: process.env.VSCE_PAT,
    packagePath: [preparedPackage],
  });
  return {
    name: "LeetDock Local Network",
    url: "https://marketplace.visualstudio.com/items?itemName=cooronx.leetdock-auth",
  };
};
