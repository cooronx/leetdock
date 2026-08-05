import * as path from "node:path";
import * as vscode from "vscode";
import { parseSolutionDocument } from "./solutionDocument";

export interface SolutionBusyState {
  readonly onDidChangeBusy: vscode.Event<void>;
  isBusy(uri: vscode.Uri): boolean;
}

export class SolutionCodeLensProvider implements vscode.CodeLensProvider {
  public readonly onDidChangeCodeLenses: vscode.Event<void>;

  public constructor(private readonly busyState: SolutionBusyState) {
    this.onDidChangeCodeLenses = busyState.onDidChangeBusy;
  }

  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const metadata = parseSolutionDocument(
      document.getText(),
      path.basename(document.uri.fsPath),
    );
    if (metadata === undefined) {
      return [];
    }

    const range = new vscode.Range(0, 0, 0, 0);
    if (this.busyState.isBusy(document.uri)) {
      return [new vscode.CodeLens(range, {
        title: "$(sync~spin) 运行中…",
        command: "leetdock.solutionBusy",
      })];
    }

    return [
      new vscode.CodeLens(range, {
        title: "$(beaker) 测试",
        command: "leetdock.testSolution",
        arguments: [document.uri],
      }),
      new vscode.CodeLens(range, {
        title: "$(cloud-upload) 提交",
        command: "leetdock.submitSolution",
        arguments: [document.uri],
      }),
    ];
  }
}
