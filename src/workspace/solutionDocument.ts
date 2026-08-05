import type { SupportedLanguage } from "./languageService";

const FILE_EXTENSIONS: Readonly<Record<SupportedLanguage, string>> = {
  cpp: ".cpp",
  rust: ".rs",
  python: ".py",
  java: ".java",
  typescript: ".ts",
};

const SUPPORTED_LANGUAGE_IDS = new Set<SupportedLanguage>([
  "cpp",
  "rust",
  "python",
  "java",
  "typescript",
]);

export interface SolutionMetadata {
  readonly frontendId: string;
  readonly title: string;
  readonly titleSlug: string;
  readonly language: SupportedLanguage;
}

/** Parses the generated header and rejects ordinary source files. */
export function parseSolutionDocument(
  contents: string,
  fileName?: string,
): SolutionMetadata | undefined {
  const lines = contents.split(/\r?\n/, 16);
  if (!lines.some((line) => /^\s*(?:\/\/|#)\s*@leetdock\s*$/.test(line))) {
    return undefined;
  }

  const fields = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(
      /^\s*(?:\/\/|#)\s*(id|title|slug|language):\s*(.*?)\s*$/,
    );
    const key = match?.[1];
    const value = match?.[2];
    if (key === undefined || value === undefined) {
      continue;
    }
    if (fields.has(key)) {
      return undefined;
    }
    fields.set(key, value);
  }

  const frontendId = nonEmpty(fields.get("id"));
  const title = nonEmpty(fields.get("title"));
  const titleSlug = nonEmpty(fields.get("slug"));
  const languageValue = nonEmpty(fields.get("language"));
  if (
    frontendId === undefined ||
    title === undefined ||
    titleSlug === undefined ||
    !/^[a-z\d][a-z\d-]*$/i.test(titleSlug) ||
    !isSupportedLanguageId(languageValue)
  ) {
    return undefined;
  }

  if (
    fileName !== undefined &&
    fileName.toLocaleLowerCase("en-US") !==
      `solution${FILE_EXTENSIONS[languageValue]}`
  ) {
    return undefined;
  }

  return { frontendId, title, titleSlug, language: languageValue };
}

export function isSolutionFileName(fileName: string): boolean {
  const normalized = fileName.toLocaleLowerCase("en-US");
  return Object.values(FILE_EXTENSIONS).some(
    (extension) => normalized === `solution${extension}`,
  );
}

function isSupportedLanguageId(value: string | undefined): value is SupportedLanguage {
  return value !== undefined && SUPPORTED_LANGUAGE_IDS.has(value as SupportedLanguage);
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}
