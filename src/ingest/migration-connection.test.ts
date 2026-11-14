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

  it("rejects the transaction pooler", () => {
    expect(() =>
      migrationConnectionString({ DATABASE_URL: "postgresql://app:secret@pooler:6543/postgres" }),
    ).toThrow(/MIGRATION_DATABASE_URL/);
  });

  it("accepts a Unix socket path", () => {
    expect(migrationConnectionString({ DATABASE_URL: "/var/run/postgresql autometa" })).toBe(
      "/var/run/postgresql autometa",
    );
  });

  it("leaves malformed strings to pg instead of throwing an error that holds the password", () => {
    const malformed = "postgres://app:hunter2@db:bad/autometa";
    expect(migrationConnectionString({ DATABASE_URL: malformed })).toBe(malformed);
  });
});
