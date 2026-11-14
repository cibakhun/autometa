import { describe, expect, it } from "vitest";
import { migrationConnectionString } from "./migration-connection";

describe("migrationConnectionString", () => {
  it("uses DATABASE_URL by default", () => {
    const url = "postgres://app:secret@db:5432/autometa";
    expect(migrationConnectionString({ DATABASE_URL: url })).toBe(url);
  });

  it("prefers MIGRATION_DATABASE_URL", () => {
    expect(
      migrationConnectionString({
        DATABASE_URL: "postgres://app:secret@pooler:6543/postgres",
        MIGRATION_DATABASE_URL: "postgres://app:secret@db:5432/postgres",
      }),
    ).toBe("postgres://app:secret@db:5432/postgres");
  });

  it("fails when no connection string is set", () => {
    expect(() => migrationConnectionString({})).toThrow(/DATABASE_URL is not set/);
    expect(() => migrationConnectionString({ DATABASE_URL: "" })).toThrow(/DATABASE_URL is not set/);
  });

  it.each([
    ["in the authority", { DATABASE_URL: "postgresql://app:secret@pooler:6543/postgres" }],
    ["as a query parameter", { DATABASE_URL: "postgresql://app@pooler/postgres?port=6543" }],
    ["with no host in the URL", { DATABASE_URL: "postgresql://app@/postgres?host=pooler&port=6543" }],
    ["through PGPORT", { DATABASE_URL: "postgresql://app@pooler/postgres", PGPORT: "6543" }],
  ])("rejects the transaction pooler port %s", (_, env) => {
    expect(() => migrationConnectionString(env)).toThrow(/MIGRATION_DATABASE_URL/);
  });

  it("lets the string's own port win over PGPORT", () => {
    const url = "postgresql://app@db:5432/postgres";
    expect(migrationConnectionString({ DATABASE_URL: url, PGPORT: "6543" })).toBe(url);
  });

  it("accepts a Unix socket path", () => {
    expect(migrationConnectionString({ DATABASE_URL: "/var/run/postgresql autometa" })).toBe(
      "/var/run/postgresql autometa",
    );
  });

  it("keeps the password out of the error for a malformed string", () => {
    let error: unknown;
    try {
      migrationConnectionString({ DATABASE_URL: "postgres://app:hunter2@db:bad/autometa" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain("hunter2");
  });
});
