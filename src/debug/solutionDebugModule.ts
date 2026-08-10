import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { ProblemService } from "../problem/problemService";
import { ExecutionPanelManager } from "../webview/executionPanel";
import {
  parseSolutionDocument,
  type SolutionMetadata,
} from "../workspace/solutionDocument";
import { isNativeAbsolutePath } from "../workspace/nativePath";
import {
  parseDebugTestCase,
  renderCppDebugProgram,
} from "./cppDebugProgram";
import {
  getDebugSampleInputs,
  previewDebugInput,
  type SupportedDebugProblemSpec,
} from "./problemSpec";

const CPPTOOLS_EXTENSION_ID = "ms-vscode.cpptools";
const OPEN_LOG_ACTION = "打开日志";
const INSTALL_CPPTOOLS_ACTION = "安装 C/C++ 扩展";

interface DebugChoice extends vscode.QuickPickItem {
  readonly choiceKind: "sample" | "custom";
  readonly input?: string;
}

interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface DebugArtifact {
  readonly token: string;
  readonly directory: vscode.Uri;
}

/** Owns the complete local-debug workflow behind one command-level interface. */
export class SolutionDebugModule implements vscode.Disposable {
  private readonly customInputs = new Map<string, string>();
  private readonly output = vscode.window.createOutputChannel("LeetDock Debug");
  private readonly debugRoot: vscode.Uri;
  private readonly pendingArtifacts = new Map<string, DebugArtifact>();
  private readonly activeArtifacts = new Map<string, DebugArtifact>();
  private readonly disposables: vscode.Disposable[];
  private storageReady: Promise<void> | undefined;

  public constructor(
    context: vscode.ExtensionContext,
    private readonly problems: ProblemService,
    private readonly panels: ExecutionPanelManager,
  ) {
    this.debugRoot = vscode.Uri.joinPath(context.globalStorageUri, "debug");
    this.disposables = [
      vscode.debug.onDidStartDebugSession((session) => this.handleSessionStarted(session)),
      vscode.debug.onDidTerminateDebugSession((session) =>
        this.handleSessionTerminated(session)
      ),
    ];
  }

  public async debug(input?: unknown): Promise<void> {
    const uri = activeSolutionUri(input);
    if (uri === undefined) {
      await vscode.window.showInformationMessage(
        "请先打开或选择一个 LeetDock solution.cpp 文件。",
      );
      return;
    }

    const metadata = await readMetadata(uri);
    if (metadata === undefined) {
      await vscode.window.showErrorMessage(
        "当前文件不是有效的 LeetDock solution 文件，或文件头元数据已被修改。",
      );
      return;
    }
    if (metadata.language !== "cpp") {
      await vscode.window.showInformationMessage("首版调试功能仅支持 C++ solution.cpp。");
      return;
    }

    const spec = await this.problems.getDebugProblemSpec(metadata.titleSlug);
    if (spec.kind === "unsupported") {
      await vscode.window.showErrorMessage(`暂不支持调试：${spec.reason}`);
      return;
    }

    const samples = getDebugSampleInputs(spec);
    const choices: DebugChoice[] = samples.map((sample, index) => ({
      label: `$(debug-alt) 官方样例 ${index + 1}`,
      description: previewDebugInput(sample) || "无参数",
      choiceKind: "sample",
      input: sample,
    }));
    if (spec.parameters.length > 0) {
      choices.push({
        label: "$(edit) 自定义输入",
        description: "每个参数一行，使用 LeetCode JSON 格式",
        choiceKind: "custom",
      });
    }

    const selected = await vscode.window.showQuickPick(choices, {
      title: `调试/Debug ${metadata.frontendId}. ${metadata.title}`,
      placeHolder: "选择本次调试使用的一个输入用例",
      ignoreFocusOut: true,
    });
    if (selected === undefined) {
      return;
    }
    if (selected.choiceKind === "sample") {
      await this.launch(uri, metadata, spec, selected.input ?? "");
      return;
    }

    const initialInput = this.customInputs.get(metadata.titleSlug) ?? samples[0] ?? "";
    this.showCustomInput(uri, metadata, spec, initialInput);
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.output.dispose();
  }

  private showCustomInput(
    uri: vscode.Uri,
    metadata: SolutionMetadata,
    spec: SupportedDebugProblemSpec,
    input: string,
  ): void {
    const runCustom = async (customInput: string): Promise<void> => {
      this.customInputs.set(metadata.titleSlug, customInput);
      const started = await this.launch(uri, metadata, spec, customInput);
      if (started) {
        this.panels.close();
      } else {
        this.showCustomInput(uri, metadata, spec, customInput);
      }
    };
    this.panels.showCustomInput(
      {
        frontendId: metadata.frontendId,
        title: metadata.title,
      },
      input,
      runCustom,
      "debug",
    );
  }

  private async launch(
    uri: vscode.Uri,
    expectedMetadata: SolutionMetadata,
    spec: SupportedDebugProblemSpec,
    rawInput: string,
  ): Promise<boolean> {
    try {
      if (uri.scheme !== "file") {
        await vscode.window.showErrorMessage("本地 C++ 调试仅支持文件系统中的 solution.cpp。");
        return false;
      }
      if (!isNativeAbsolutePath(uri.fsPath)) {
        await vscode.window.showErrorMessage(
          "当前 solution.cpp 使用了其他操作系统的路径。请重新打开题目代码并选择本机代码目录。",
        );
        return false;
      }
      const testCase = parseDebugTestCase(rawInput, spec.parameters);
      const document = await vscode.workspace.openTextDocument(uri);
      if (document.isDirty && !(await document.save())) {
        await vscode.window.showErrorMessage("无法保存 solution.cpp，调试已取消。");
        return false;
      }
      const currentMetadata = parseSolutionDocument(
        document.getText(),
        path.basename(document.uri.fsPath),
      );
      if (
        currentMetadata === undefined ||
        currentMetadata.language !== "cpp" ||
        currentMetadata.titleSlug !== expectedMetadata.titleSlug
      ) {
        await vscode.window.showErrorMessage(
          "solution.cpp 的 LeetDock 元数据已变化，调试已取消。",
        );
        return false;
      }
      if (process.platform !== "linux" && process.platform !== "win32") {
        await vscode.window.showErrorMessage(
          "本地 C++ 调试目前仅支持 Linux 和 Windows。",
        );
        return false;
      }
      if (!(await this.ensureCppTools())) {
        return false;
      }

      const configuration = vscode.workspace.getConfiguration("leetdock", uri);
      const compilerPath = configuredExecutable(
        configuration.get<unknown>("debug.cpp.compilerPath"),
        "g++",
      );
      const debuggerPath = configuredExecutable(
        configuration.get<unknown>("debug.cpp.debuggerPath"),
        "gdb",
      );
      if (!(await this.ensureDebugger(debuggerPath))) {
        return false;
      }

      await this.ensureStorage();
      const artifact = await this.createArtifact(
        uri,
        expectedMetadata,
        spec,
        testCase,
      );
      let handedToDebugger = false;
      try {
        const program = vscode.Uri.joinPath(
          artifact.directory,
          process.platform === "win32" ? "program.exe" : "program",
        );
        const source = vscode.Uri.joinPath(artifact.directory, "main.cpp");
        const compiled = await this.compile(
          compilerPath,
          source.fsPath,
          program.fsPath,
          artifact.directory.fsPath,
        );
        if (!compiled) {
          return false;
        }

        this.pendingArtifacts.set(artifact.token, artifact);
        const sessionName = debugSessionName(
          expectedMetadata.frontendId,
          artifact.token,
        );
        const toolPath = windowsToolPath([compilerPath, debuggerPath]);
        const started = await vscode.debug.startDebugging(
          vscode.workspace.getWorkspaceFolder(uri),
          {
            type: "cppdbg",
            request: "launch",
            name: sessionName,
            program: program.fsPath,
            cwd: path.dirname(uri.fsPath),
            args: [],
            stopAtEntry: false,
            externalConsole: false,
            MIMode: "gdb",
            miDebuggerPath: debuggerPath,
            ...(toolPath === undefined
              ? {}
              : { environment: [{ name: "PATH", value: toolPath }] }),
            setupCommands: [
              {
                description: "Enable pretty-printing for gdb",
                text: "-enable-pretty-printing",
                ignoreFailures: true,
              },
            ],
            __leetdockDebugToken: artifact.token,
          },
          { suppressSaveBeforeStart: true },
        );
        if (!started) {
          this.pendingArtifacts.delete(artifact.token);
          await vscode.window.showErrorMessage(
            "VS Code 未能启动 C++ 调试会话，请确认 C/C++ 扩展可用。",
          );
          return false;
        }
        handedToDebugger = true;
        return true;
      } finally {
        if (!handedToDebugger) {
          this.pendingArtifacts.delete(artifact.token);
          await deleteUri(artifact.directory);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`调试启动失败：${message}`);
      const selected = await vscode.window.showErrorMessage(
        message,
        OPEN_LOG_ACTION,
      );
      if (selected === OPEN_LOG_ACTION) {
        this.output.show(true);
      }
      return false;
    }
  }

  private async ensureCppTools(): Promise<boolean> {
    if (vscode.extensions.getExtension(CPPTOOLS_EXTENSION_ID) !== undefined) {
      return true;
    }
    const selected = await vscode.window.showErrorMessage(
      "调试 C++ 需要安装 Microsoft C/C++ 扩展。",
      INSTALL_CPPTOOLS_ACTION,
    );
    if (selected === INSTALL_CPPTOOLS_ACTION) {
      await vscode.commands.executeCommand(
        "workbench.extensions.installExtension",
        CPPTOOLS_EXTENSION_ID,
      );
    }
    return false;
  }

  private async ensureDebugger(debuggerPath: string): Promise<boolean> {
    try {
      const result = await runProcess(debuggerPath, ["--version"]);
      if (result.exitCode === 0) {
        return true;
      }
      this.output.appendLine(result.stdout);
      this.output.appendLine(result.stderr);
      await vscode.window.showErrorMessage(
        `无法运行 GDB：${debuggerPath}。请检查 leetdock.debug.cpp.debuggerPath。`,
      );
      return false;
    } catch (error) {
      if (isExecutableMissing(error)) {
        await vscode.window.showErrorMessage(
          `找不到 GDB：${debuggerPath}。请安装 gdb 或配置 leetdock.debug.cpp.debuggerPath。`,
        );
        return false;
      }
      throw error;
    }
  }

  private async createArtifact(
    solutionUri: vscode.Uri,
    metadata: SolutionMetadata,
    spec: SupportedDebugProblemSpec,
    testCase: ReturnType<typeof parseDebugTestCase>,
  ): Promise<DebugArtifact> {
    const token = randomUUID();
    const directory = vscode.Uri.joinPath(this.debugRoot, token);
    await vscode.workspace.fs.createDirectory(directory);
    const source = renderCppDebugProgram({
      solutionPath: solutionUri.fsPath,
      spec,
      testCase,
    });
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(directory, "main.cpp"),
      new TextEncoder().encode(source),
    );
    this.output.appendLine("");
    this.output.appendLine(
      `正在构建 ${metadata.frontendId}. ${metadata.title} 的本地调试程序。`,
    );
    return { token, directory };
  }

  private async compile(
    compilerPath: string,
    sourcePath: string,
    programPath: string,
    cwd: string,
  ): Promise<boolean> {
    const args = [
      "-std=c++17",
      "-O0",
      "-g3",
      ...(process.platform === "win32" ? ["-static"] : []),
      sourcePath,
      "-o",
      programPath,
    ];
    this.output.appendLine(formatCommand(compilerPath, args));
    let result: ProcessResult;
    try {
      result = await runProcess(compilerPath, args, cwd);
    } catch (error) {
      if (isExecutableMissing(error)) {
        await vscode.window.showErrorMessage(
          `找不到 C++ 编译器：${compilerPath}。请安装 g++ 或配置 leetdock.debug.cpp.compilerPath。`,
        );
        return false;
      }
      throw error;
    }
    appendProcessOutput(this.output, result);
    if (result.exitCode === 0) {
      this.output.appendLine("调试程序编译完成，正在启动 GDB。");
      return true;
    }

    const selected = await vscode.window.showErrorMessage(
      "C++ 调试程序编译失败，请查看 LeetDock Debug 输出。",
      OPEN_LOG_ACTION,
    );
    if (selected === OPEN_LOG_ACTION) {
      this.output.show(true);
    }
    return false;
  }

  private ensureStorage(): Promise<void> {
    this.storageReady ??= (async () => {
      await deleteUri(this.debugRoot);
      await vscode.workspace.fs.createDirectory(this.debugRoot);
    })();
    return this.storageReady;
  }

  private handleSessionStarted(session: vscode.DebugSession): void {
    const token = debugSessionToken(session);
    if (token === undefined) {
      return;
    }
    const artifact = this.pendingArtifacts.get(token);
    if (artifact === undefined) {
      return;
    }
    this.pendingArtifacts.delete(token);
    this.activeArtifacts.set(session.id, artifact);
  }

  private handleSessionTerminated(session: vscode.DebugSession): void {
    const token = debugSessionToken(session);
    const artifact = this.activeArtifacts.get(session.id) ??
      (token === undefined ? undefined : this.pendingArtifacts.get(token));
    if (artifact === undefined) {
      return;
    }
    this.activeArtifacts.delete(session.id);
    this.pendingArtifacts.delete(artifact.token);
    void deleteUri(artifact.directory);
  }
}

function activeSolutionUri(input: unknown): vscode.Uri | undefined {
  if (input instanceof vscode.Uri) {
    return input;
  }
  return vscode.window.activeTextEditor?.document.uri;
}

async function readMetadata(uri: vscode.Uri): Promise<SolutionMetadata | undefined> {
  const document = await vscode.workspace.openTextDocument(uri);
  return parseSolutionDocument(document.getText(), path.basename(document.uri.fsPath));
}

function configuredExecutable(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function debugSessionName(frontendId: string, token: string): string {
  return `LeetDock 调试/Debug · ${frontendId} [${token}]`;
}

function debugSessionToken(session: vscode.DebugSession): string | undefined {
  const configured = Reflect.get(session.configuration, "__leetdockDebugToken");
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }
  const match = session.name.match(/\[([0-9a-f-]{36})\]$/i);
  return match?.[1];
}

function runProcess(
  command: string,
  args: readonly string[],
  cwd?: string,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const toolPath = windowsToolPath([command]);
    const child = spawn(command, args, {
      ...(cwd === undefined ? {} : { cwd }),
      ...(toolPath === undefined
        ? {}
        : { env: environmentWithPath(toolPath) }),
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (exitCode, signal) => {
      if (!settled) {
        settled = true;
        resolve({ exitCode, signal, stdout, stderr });
      }
    });
  });
}

function windowsToolPath(commands: readonly string[]): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }

  const directories: string[] = [];
  const seen = new Set<string>();
  for (const command of commands) {
    if (!path.win32.isAbsolute(command)) {
      continue;
    }
    const directory = path.win32.dirname(command);
    const key = directory.toLocaleLowerCase("en-US");
    if (!seen.has(key)) {
      seen.add(key);
      directories.push(directory);
    }
  }
  if (directories.length === 0) {
    return undefined;
  }

  const inherited = process.env.Path ?? process.env.PATH;
  return [...directories, inherited]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(path.win32.delimiter);
}

function environmentWithPath(toolPath: string): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.toLocaleLowerCase("en-US") === "path") {
      delete environment[key];
    }
  }
  environment.PATH = toolPath;
  return environment;
}

function isExecutableMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "code") === "ENOENT"
  );
}

function appendProcessOutput(
  output: vscode.OutputChannel,
  result: ProcessResult,
): void {
  if (result.stdout.trim().length > 0) {
    output.appendLine(result.stdout.trimEnd());
  }
  if (result.stderr.trim().length > 0) {
    output.appendLine(result.stderr.trimEnd());
  }
  if (result.signal !== null) {
    output.appendLine(`进程被信号 ${result.signal} 终止。`);
  } else if (result.exitCode !== 0) {
    output.appendLine(`进程退出码：${result.exitCode ?? "unknown"}`);
  }
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(formatCommandArgument).join(" ");
}

function formatCommandArgument(value: string): string {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

async function deleteUri(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    (error instanceof vscode.FileSystemError && error.code === "FileNotFound") ||
    (
      typeof error === "object" &&
      error !== null &&
      (Reflect.get(error, "code") === "FileNotFound" ||
        Reflect.get(error, "code") === "ENOENT")
    )
  );
}
