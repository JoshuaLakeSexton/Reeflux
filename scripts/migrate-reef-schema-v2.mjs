import { Redis } from "@upstash/redis";

const REEF_SCHEMA_VERSION = "2";
const MIGRATION_ID = "2026-03-21-reef-schema-v2";
const KNOWN_POOLS = Object.freeze(["tide", "ambient", "fractal", "sandbox"]);

function requireEnv(name) {
  const value = String(process.env[name] || "").trim().replace(/^['"]+|['"]+$/g, "");
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

async function main() {
  const dryRun = process.env.REEF_MIGRATION_DRY_RUN === "true";

  const redis = new Redis({
    url: requireEnv("UPSTASH_REDIS_REST_URL"),
    token: requireEnv("UPSTASH_REDIS_REST_TOKEN"),
  });

  const now = Date.now();
  const appliedAt = new Date(now).toISOString();

  const before = {
    schemaVersion: await redis.get("reef:schema:version"),
    firstSeenAt: await redis.get("reef:service:first_seen_at"),
    knownPools: toArray(await redis.smembers("reef:pools:known")),
    migrationAppliedAt: await redis.hget("reef:migrations:applied", MIGRATION_ID),
  };

  if (!dryRun) {
    await redis.set("reef:schema:version", REEF_SCHEMA_VERSION);
    await redis.sadd("reef:pools:known", ...KNOWN_POOLS);

    if (!before.firstSeenAt) {
      await redis.set("reef:service:first_seen_at", String(now));
    }

    await redis.hset("reef:migrations:applied", {
      [MIGRATION_ID]: appliedAt,
    });
  }

  const after = {
    schemaVersion: dryRun ? before.schemaVersion : await redis.get("reef:schema:version"),
    firstSeenAt: dryRun ? before.firstSeenAt : await redis.get("reef:service:first_seen_at"),
    knownPools: dryRun ? before.knownPools : toArray(await redis.smembers("reef:pools:known")),
    migrationAppliedAt: dryRun
      ? before.migrationAppliedAt
      : await redis.hget("reef:migrations:applied", MIGRATION_ID),
  };

  const summary = {
    migration: MIGRATION_ID,
    schemaTarget: REEF_SCHEMA_VERSION,
    dryRun,
    before,
    after,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(`[${MIGRATION_ID}] failed`);
  console.error(error?.message || error);
  process.exit(1);
});
