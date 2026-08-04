import { writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { CodeSnippet, ProblemDetail } from "../leetcode/types";
import {
  getLanguageDefinition,
  LanguageService,
  type LanguageDefinition,
  type SupportedLanguage,
} from "./languageService";

export const SOLUTION_ROOT_STATE_KEY = "leetdock.solutionRoot";

/** Creates or reopens local solution files without exposing filesystem policy. */
export class CodeFileService {
  private operationTail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly languages = new LanguageService(),
  ) {}

  public open(
    problem: ProblemDetail,
    language?: SupportedLanguage,
  ): Promise<vscode.Uri | undefined> {
    const result = this.operationTail.then(
      () => this.openInternal(problem, language),
      () => this.openInternal(problem, language),
    );
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async openInternal(
    problem: ProblemDetail,
    requestedLanguage?: SupportedLanguage,
  ): Promise<vscode.Uri | undefined> {
    const language = requestedLanguage ?? await this.languages.getDefaultLanguage();
    if (language === undefined) {
      return undefined;
    }

    const definition = getLanguageDefinition(language);
    const root = await this.resolveSolutionRoot();
    const problemDirectory = vscode.Uri.joinPath(root, problemDirectoryName(problem));
    const file = vscode.Uri.joinPath(
      problemDirectory,
      `solution${definition.extension}`,
    );

    const existingType = await statType(file);
    if (existingType !== undefined) {
      if ((existingType & vscode.FileType.Directory) !== 0) {
        await vscode.window.showErrorMessage(
          `无法打开代码文件：${file.fsPath} 已存在且不是文件。`,
        );
        return undefined;
      }
      await showSolutionFile(file);
      return file;
    }

    const snippet = findCodeSnippet(problem.codeSnippets, definition);
    if (snippet === undefined) {
      if (problem.paidOnly) {
        await vscode.window.showWarningMessage(
          "该题目需要 LeetDock 会员权限，当前账号未获得代码模板。",
        );
        return undefined;
      }
      await vscode.window.showWarningMessage(
        `题目“${displayTitle(problem)}”没有可用的 ${definition.label} 代码模板，无法创建 solution${definition.extension}。`,
      );
      return undefined;
    }

    await vscode.workspace.fs.createDirectory(problemDirectory);

    // A second check avoids unnecessary work; the exclusive write below remains
    // the final protection against another process creating the file concurrently.
    const concurrentlyCreatedType = await statType(file);
    if (concurrentlyCreatedType !== undefined) {
      if ((concurrentlyCreatedType & vscode.FileType.Directory) !== 0) {
        await vscode.window.showErrorMessage(
          `无法创建代码文件：${file.fsPath} 已存在且不是文件。`,
        );
        return undefined;
      }
      await showSolutionFile(file);
      return file;
    }

    const contents = renderSolution(problem, definition, snippet);
    try {
      await writeFile(file.fsPath, contents, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (!isFileAlreadyExists(error)) {
        throw error;
      }
      const racedType = await statType(file);
      if (racedType !== undefined && (racedType & vscode.FileType.Directory) !== 0) {
        await vscode.window.showErrorMessage(
          `无法创建代码文件：${file.fsPath} 已存在且不是文件。`,
        );
        return undefined;
      }
      await showSolutionFile(file);
      return file;
    }
    await showSolutionFile(file);
    return file;
  }

  private async resolveSolutionRoot(): Promise<vscode.Uri> {
    const storedPath = this.context.globalState.get<unknown>(
      SOLUTION_ROOT_STATE_KEY,
    );
    if (
      typeof storedPath === "string" &&
      storedPath.trim().length > 0 &&
      path.isAbsolute(storedPath)
    ) {
      return vscode.Uri.file(storedPath);
    }

    const fallbackPath = path.join(os.homedir(), "leetdock");
    const selection = await vscode.window.showOpenDialog({
      title: "选择 LeetDock 代码根目录",
      openLabel: "选择代码目录",
      defaultUri: vscode.Uri.file(os.homedir()),
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    const root = selection?.[0] ?? vscode.Uri.file(fallbackPath);
    if (selection === undefined) {
      await vscode.window.showInformationMessage(
        `未选择代码目录，将使用默认位置：${root.fsPath}`,
      );
    }
    await this.context.globalState.update(SOLUTION_ROOT_STATE_KEY, root.fsPath);
    return root;
  }
}

function findCodeSnippet(
  snippets: readonly CodeSnippet[],
  definition: LanguageDefinition,
): CodeSnippet | undefined {
  for (const languageSlug of definition.snippetLanguageSlugs) {
    const snippet = snippets.find(
      (candidate) =>
        candidate.languageSlug.trim().toLocaleLowerCase("en-US") === languageSlug,
    );
    if (snippet !== undefined) {
      return snippet;
    }
  }
  return undefined;
}

function renderSolution(
  problem: ProblemDetail,
  definition: LanguageDefinition,
  snippet: CodeSnippet,
): string {
  const comment = definition.lineComment;
  const metadata = [
    "@leetdock",
    `id: ${safeMetadataValue(problem.frontendId)}`,
    `title: ${safeMetadataValue(displayTitle(problem))}`,
    `slug: ${safeMetadataValue(problem.titleSlug)}`,
    `language: ${definition.id}`,
  ].map((line) => `${comment} ${line}`).join("\n");
  const code = snippet.code.endsWith("\n") ? snippet.code : `${snippet.code}\n`;
  return `${metadata}\n\n${code}`;
}

function problemDirectoryName(problem: ProblemDetail): string {
  return `${paddedFrontendId(problem.frontendId)}-${safeSlug(problem.titleSlug)}`;
}

function paddedFrontendId(frontendId: string): string {
  const trimmed = frontendId.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed.replace(/^0+(?=\d)/, "").padStart(4, "0");
  }
  return safePathSegment(trimmed, "problem");
}

function safeSlug(value: string): string {
  return safePathSegment(value, "problem");
}

function safePathSegment(value: string, fallback: string): string {
  const safe = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe.length === 0 ? fallback : safe;
}

function safeMetadataValue(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayTitle(problem: ProblemDetail): string {
  return problem.translatedTitle?.trim() || problem.title;
}

async function statType(uri: vscode.Uri): Promise<vscode.FileType | undefined> {
  try {
    return (await vscode.workspace.fs.stat(uri)).type;
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    (error instanceof vscode.FileSystemError && error.code === "FileNotFound") ||
    (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "FileNotFound"
    )
  );
}

function isFileAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

async function showSolutionFile(uri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: false,
  });
}
