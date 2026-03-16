import { strict as assert } from "assert";
import { envBool, envInt, envString, requireEnv } from "../../src/integrations/envHelper";

describe("envHelper", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("requireEnv", () => {
    it("returns trimmed value when present", () => {
      process.env.TEST_KEY = " value ";
      assert.equal(requireEnv("TEST_KEY"), "value");
    });

    it("throws when missing or empty", () => {
      delete process.env.TEST_KEY;
      assert.throws(() => requireEnv("TEST_KEY"));
      process.env.TEST_KEY = "   ";
      assert.throws(() => requireEnv("TEST_KEY"));
    });
  });

  describe("envString", () => {
    it("returns trimmed value when set", () => {
      process.env.TEST_KEY = "  hello  ";
      assert.equal(envString("TEST_KEY", "fallback"), "hello");
    });

    it("returns fallback when unset or blank", () => {
      delete process.env.TEST_KEY;
      assert.equal(envString("TEST_KEY", "fallback"), "fallback");
      process.env.TEST_KEY = "   ";
      assert.equal(envString("TEST_KEY", "fallback"), "fallback");
    });
  });

  describe("envBool", () => {
    it("parses true-ish and false-ish values", () => {
      process.env.TRUE_KEY = "true";
      process.env.ONE_KEY = "1";
      process.env.FALSE_KEY = "false";
      process.env.ZERO_KEY = "0";
      assert.equal(envBool("TRUE_KEY"), true);
      assert.equal(envBool("ONE_KEY"), true);
      assert.equal(envBool("FALSE_KEY"), false);
      assert.equal(envBool("ZERO_KEY"), false);
    });

    it("returns fallback when undefined or empty", () => {
      delete process.env.MISSING_KEY;
      assert.equal(envBool("MISSING_KEY", true), true);
      process.env.MISSING_KEY = "   ";
      assert.equal(envBool("MISSING_KEY", false), false);
    });
  });

  describe("envInt", () => {
    it("parses integers and trims input", () => {
      process.env.NUM_KEY = " 42 ";
      assert.equal(envInt("NUM_KEY"), 42);
    });

    it("returns fallback when missing, empty, or NaN", () => {
      delete process.env.NUM_KEY;
      assert.equal(envInt("NUM_KEY", 5), 5);
      process.env.NUM_KEY = "   ";
      assert.equal(envInt("NUM_KEY", 7), 7);
      process.env.NUM_KEY = "not-a-number";
      assert.equal(envInt("NUM_KEY", 9), 9);
    });
  });
});
