export class StoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "StoreError";
  }
}
