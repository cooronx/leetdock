import * as vscode from "vscode";
import type { ProblemSummary } from "../leetcode/types";
import { ProblemService } from "../problem/problemService";
import { ProblemPanelManager } from "../webview/problemPanel";

interface ProblemQuickPickItem extends vscode.QuickPickItem {
  readonly problem: ProblemSummary;
}

export async function openProblemCommand(
  service: ProblemService,
  panels: ProblemPanelManager,
  input?: unknown,
): Promise<void> {
  const keyword = commandInput(input) ?? await vscode.window.showInputBox({
    title: "LeetDock：打开题目",
    prompt: "输入题号、中文或英文名称、titleSlug 或 leetcode.cn URL",
    placeHolder: "例如：1、两数之和、two-sum",
    ignoreFocusOut: true,
    validateInput: (value) => value.trim().length === 0 ? "请输入题目信息。" : undefined,
  });
  if (keyword === undefined) {
    return;
  }

  const result = await withLookupProgress(() => service.lookup(keyword));
  if (result.kind === "problem") {
    panels.open(result.problem);
    return;
  }

  const selected = await pickProblem(result.problems, "选择要打开的题目");
  if (selected === undefined) {
    return;
  }
  panels.open(await withLookupProgress(() => service.openProblem(selected.titleSlug)));
}

export async function searchProblemCommand(
  service: ProblemService,
  panels: ProblemPanelManager,
): Promise<void> {
  const keyword = await vscode.window.showInputBox({
    title: "LeetDock：搜索题目",
    prompt: "输入中文名、英文名或关键词",
    placeHolder: "例如：哈希表、Two Sum",
    ignoreFocusOut: true,
    validateInput: (value) => value.trim().length === 0 ? "请输入搜索关键词。" : undefined,
  });
  if (keyword === undefined) {
    return;
  }

  const problems = await withLookupProgress(() => service.search(keyword));
  const selected = await pickProblem(problems, `“${keyword.trim()}”的搜索结果`);
  if (selected === undefined) {
    return;
  }
  panels.open(await withLookupProgress(() => service.openProblem(selected.titleSlug)));
}

export async function refreshProblemCommand(
  panels: ProblemPanelManager,
): Promise<void> {
  const active = panels.getActiveProblem();
  if (active === undefined) {
    await vscode.window.showInformationMessage("请先打开一道 LeetDock 题目。");
    return;
  }
  await withLookupProgress(() => panels.refresh(active.titleSlug));
}

async function pickProblem(
  problems: readonly ProblemSummary[],
  title: string,
): Promise<ProblemSummary | undefined> {
  if (problems.length === 0) {
    await vscode.window.showInformationMessage("没有找到匹配的 LeetDock 题目。");
    return undefined;
  }

  const items: ProblemQuickPickItem[] = problems.map((problem) => ({
    label: `${statusIcon(problem)}${problem.frontendId}. ${displayTitle(problem)}`,
    description: `${difficultyLabel(problem)}${problem.paidOnly ? " · 会员" : ""}`,
    detail: problem.translatedTitle?.trim() ? problem.title : problem.titleSlug,
    problem,
  }));
  return (await vscode.window.showQuickPick(items, {
    title,
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  }))?.problem;
}

function commandInput(input: unknown): string | undefined {
  if (typeof input === "string" && input.trim().length > 0) {
    return input;
  }
  if (typeof input === "object" && input !== null) {
    const slug = Reflect.get(input, "titleSlug");
    if (typeof slug === "string" && slug.trim().length > 0) {
      return slug;
    }
  }
  return undefined;
}

function displayTitle(problem: ProblemSummary): string {
  return problem.translatedTitle?.trim() || problem.title;
}

function difficultyLabel(problem: ProblemSummary): string {
  switch (problem.difficulty) {
    case "Easy":
      return "简单";
    case "Medium":
      return "中等";
    case "Hard":
      return "困难";
  }
}

function statusIcon(problem: ProblemSummary): string {
  switch (problem.status) {
    case "AC":
      return "$(check) ";
    case "TRIED":
      return "$(history) ";
    case null:
      return "";
  }
}

async function withLookupProgress<T>(operation: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: "LeetDock 正在连接…",
      cancellable: false,
    },
    operation,
  );
}
