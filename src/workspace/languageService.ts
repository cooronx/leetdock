import * as vscode from "vscode";

const CONFIGURATION_SECTION = "leetdock";
const DEFAULT_LANGUAGE_SETTING = "defaultLanguage";

export const SUPPORTED_LANGUAGES = [
  "cpp",
  "rust",
  "python",
  "java",
  "typescript",
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export interface LanguageDefinition {
  readonly id: SupportedLanguage;
  readonly label: string;
  readonly extension: string;
  /** Ordered LeetCode language slugs. The first matching snippet is used. */
  readonly snippetLanguageSlugs: readonly string[];
  /** Canonical slug accepted by LeetCode's judge endpoints. */
  readonly judgeLanguageSlug: string;
  readonly lineComment: "//" | "#";
}

const LANGUAGE_DEFINITIONS: Readonly<Record<SupportedLanguage, LanguageDefinition>> = {
  cpp: {
    id: "cpp",
    label: "C++",
    extension: ".cpp",
    snippetLanguageSlugs: ["cpp"],
    judgeLanguageSlug: "cpp",
    lineComment: "//",
  },
  rust: {
    id: "rust",
    label: "Rust",
    extension: ".rs",
    snippetLanguageSlugs: ["rust"],
    judgeLanguageSlug: "rust",
    lineComment: "//",
  },
  python: {
    id: "python",
    label: "Python",
    extension: ".py",
    snippetLanguageSlugs: ["python3", "python"],
    judgeLanguageSlug: "python3",
    lineComment: "#",
  },
  java: {
    id: "java",
    label: "Java",
    extension: ".java",
    snippetLanguageSlugs: ["java"],
    judgeLanguageSlug: "java",
    lineComment: "//",
  },
  typescript: {
    id: "typescript",
    label: "TypeScript",
    extension: ".ts",
    snippetLanguageSlugs: ["typescript"],
    judgeLanguageSlug: "typescript",
    lineComment: "//",
  },
};

interface LanguageQuickPickItem extends vscode.QuickPickItem {
  readonly language: SupportedLanguage;
}

/** Owns the user-facing language choice and its global VS Code setting. */
export class LanguageService {
  public getConfiguredLanguage(): SupportedLanguage | undefined {
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const configured = configuration.get<unknown>(DEFAULT_LANGUAGE_SETTING);

    return isSupportedLanguage(configured) ? configured : undefined;
  }

  public async getDefaultLanguage(): Promise<SupportedLanguage | undefined> {
    return this.getConfiguredLanguage() ?? this.pickLanguage();
  }

  public async pickLanguage(
    current?: SupportedLanguage,
  ): Promise<SupportedLanguage | undefined> {
    const items: LanguageQuickPickItem[] = SUPPORTED_LANGUAGES.map((language) => {
      const definition = getLanguageDefinition(language);
      return {
        label: definition.label,
        description: `solution${definition.extension}`,
        picked: language === current,
        language,
      };
    });
    const selected = await vscode.window.showQuickPick(items, {
      title: current === undefined ? "选择默认编程语言" : "切换编程语言",
      placeHolder: "选择用于 LeetDock 代码文件的语言",
    });
    if (selected === undefined) {
      return undefined;
    }

    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const inspected = configuration.inspect<unknown>(DEFAULT_LANGUAGE_SETTING);
    const target = inspected?.workspaceFolderValue !== undefined
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : inspected?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await configuration.update(DEFAULT_LANGUAGE_SETTING, selected.language, target);
    return selected.language;
  }
}

export function getLanguageDefinition(
  language: SupportedLanguage,
): LanguageDefinition {
  return LANGUAGE_DEFINITIONS[language];
}

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}
