import { describe, expect, it } from "vitest";
import { errorResponse, textResponse } from "../response.js";

describe("textResponse", () => {
  it("wraps data in MCP content envelope", () => {
    const result = textResponse({ foo: "bar" });
    expect(result).toHaveProperty("content");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty("type", "text");
  });

  it("serialises to pretty-printed JSON", () => {
    const result = textResponse({ hello: "world" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ hello: "world" });
  });

  it("handles arrays", () => {
    const data = [{ id: 1 }, { id: 2 }];
    const result = textResponse(data);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(data);
  });
});

describe("errorResponse", () => {
  it("marks result as error", () => {
    const result = errorResponse("something broke");
    expect(result).toHaveProperty("isError", true);
  });

  it("includes the error message as plain text", () => {
    const result = errorResponse("disk full");
    expect(result.content[0]).toEqual({ text: "disk full", type: "text" });
  });
});
