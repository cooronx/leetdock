import * as vscode from "vscode";

const COOKIE_KEY = "leetdock.auth.cookie";

/** Keeps authentication material isolated from ordinary extension state. */
export class CredentialStore {
  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public get onDidChangeCookie(): vscode.Event<void> {
    return (listener, thisArgs, disposables) =>
      this.secrets.onDidChange(
        (event) => {
          if (event.key === COOKIE_KEY) {
            listener.call(thisArgs);
          }
        },
        undefined,
        disposables,
      );
  }

  public async getCookie(): Promise<string | undefined> {
    return this.secrets.get(COOKIE_KEY);
  }

  public async storeCookie(cookie: string): Promise<void> {
    await this.secrets.store(COOKIE_KEY, normalizeLeetCodeCookie(cookie));
  }

  public async deleteCookie(): Promise<void> {
    await this.secrets.delete(COOKIE_KEY);
  }
}

export function normalizeLeetCodeCookie(cookie: string): string {
  const normalized = cookie.trim();
  if (normalized.length === 0) {
    throw new Error("Cannot store an empty LeetCode cookie.");
  }
  if (/\r|\n/.test(normalized)) {
    throw new Error("LeetCode cookie contains invalid line breaks.");
  }
  return normalized;
}
