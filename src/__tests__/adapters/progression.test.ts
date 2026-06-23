import { describe, test, expect } from "bun:test";
import { nextStatusInProgression } from "../../adapters/progression";

const FLOW = ["Ready for Developer", "In Development", "In Review", "Ready for Test"];

describe("nextStatusInProgression", () => {
  test("advances from a middle stage", () => {
    expect(nextStatusInProgression("In Development", FLOW)).toBe("In Review");
  });

  test("advances from the first stage", () => {
    expect(nextStatusInProgression("Ready for Developer", FLOW)).toBe("In Development");
  });

  test("returns null at the last stage", () => {
    expect(nextStatusInProgression("Ready for Test", FLOW)).toBeNull();
  });

  test("returns null when current status is not in the progression", () => {
    expect(nextStatusInProgression("Done", FLOW)).toBeNull();
  });

  test("is case- and whitespace-insensitive", () => {
    expect(nextStatusInProgression("  in development  ", FLOW)).toBe("In Review");
  });

  test("returns null for empty or missing progression", () => {
    expect(nextStatusInProgression("In Development", [])).toBeNull();
    expect(nextStatusInProgression("In Development", undefined)).toBeNull();
  });

  test("returns null for missing current status", () => {
    expect(nextStatusInProgression(undefined, FLOW)).toBeNull();
  });
});
