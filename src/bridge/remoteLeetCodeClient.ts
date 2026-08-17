import * as vscode from "vscode";
import type { LeetCodeApi } from "../leetcode/api";
import type {
  CompanyQuestionPage,
  CompanyQuestionSource,
  CompanySummary,
  DailyChallenge,
  DailyStreak,
  Difficulty,
  JudgeResult,
  ProblemDetail,
  ProblemListPage,
  ProblemListProgress,
  ProblemListSummary,
  ProblemSearchPage,
  ProblemSummary,
  ProblemTag,
  TagQuestionPage,
} from "../leetcode/types";
import {
  BRIDGE_PROTOCOL_VERSION,
  executeBridgeCommand,
  LOCAL_NETWORK_COMMAND,
  type CommandExecutor,
  type LeetCodeMethod,
} from "./protocol";

export class RemoteLeetCodeClient implements LeetCodeApi {
  public constructor(
    private readonly execute: CommandExecutor = (command, argument) =>
      vscode.commands.executeCommand(command, argument),
  ) {}

  public searchProblems(
    keyword: string,
    skip = 0,
    limit = 50,
  ): Promise<ProblemSearchPage> {
    return this.call("searchProblems", [keyword, skip, limit]);
  }

  public getDifficultyQuestions(
    difficulty: Difficulty,
    skip = 0,
    limit = 50,
  ): Promise<ProblemSearchPage> {
    return this.call("getDifficultyQuestions", [difficulty, skip, limit]);
  }

  public getTags(): Promise<readonly ProblemTag[]> {
    return this.call("getTags", []);
  }

  public getTagQuestions(
    tagSlug: string,
    skip = 0,
    limit = 50,
  ): Promise<TagQuestionPage> {
    return this.call("getTagQuestions", [tagSlug, skip, limit]);
  }

  public getProblem(titleSlug: string): Promise<ProblemDetail> {
    return this.call("getProblem", [titleSlug]);
  }

  public getDailyChallenge(): Promise<DailyChallenge> {
    return this.call("getDailyChallenge", []);
  }

  public getDailyStreak(): Promise<DailyStreak> {
    return this.call("getDailyStreak", []);
  }

  public getMyProblemLists(): Promise<readonly ProblemListSummary[]> {
    return this.call("getMyProblemLists", []);
  }

  public getProblemListQuestions(
    favoriteSlug: string,
    skip = 0,
    limit = 50,
  ): Promise<ProblemListPage> {
    return this.call("getProblemListQuestions", [favoriteSlug, skip, limit]);
  }

  public getProblemListProgress(favoriteSlug: string): Promise<ProblemListProgress> {
    return this.call("getProblemListProgress", [favoriteSlug]);
  }

  public getProblemListQuestionAccepted(
    favoriteSlug: string,
    titleSlug: string,
  ): Promise<boolean> {
    return this.call("getProblemListQuestionAccepted", [favoriteSlug, titleSlug]);
  }

  public getCompanies(): Promise<readonly CompanySummary[]> {
    return this.call("getCompanies", []);
  }

  public getCompanyQuestionSource(companySlug: string): Promise<CompanyQuestionSource> {
    return this.call("getCompanyQuestionSource", [companySlug]);
  }

  public getCompanyQuestions(
    companySlug: string,
    favoriteSlug: string,
    skip = 0,
    limit = 50,
  ): Promise<CompanyQuestionPage> {
    return this.call("getCompanyQuestions", [companySlug, favoriteSlug, skip, limit]);
  }

  public testSolution(
    problem: ProblemDetail,
    languageSlug: string,
    code: string,
    input: string,
  ): Promise<JudgeResult> {
    return this.call("testSolution", [problem, languageSlug, code, input]);
  }

  public submitSolution(
    problem: ProblemDetail,
    languageSlug: string,
    code: string,
  ): Promise<JudgeResult> {
    return this.call("submitSolution", [problem, languageSlug, code]);
  }

  public getProblemIndex(): Promise<readonly ProblemSummary[]> {
    return this.call("getProblemIndex", []);
  }

  private call<T>(method: LeetCodeMethod, args: readonly unknown[]): Promise<T> {
    return executeBridgeCommand<T>(this.execute, LOCAL_NETWORK_COMMAND, {
      version: BRIDGE_PROTOCOL_VERSION,
      method,
      args,
    });
  }
}
