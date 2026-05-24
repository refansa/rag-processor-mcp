export class AbortError extends Error {
  constructor(message?: string) {
    super(message ?? "Operation cancelled");
    this.name = "AbortError";
  }
}
