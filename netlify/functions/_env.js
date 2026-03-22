function sanitizeEnvValue(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^['"]+|['"]+$/g, "");
}

function readEnv(name) {
  return sanitizeEnvValue(process.env[name] || "");
}

function getMissingEnv(names) {
  return names.filter((name) => !readEnv(name));
}

function validateRequiredEnv(names) {
  const missing = getMissingEnv(names);
  return {
    ok: missing.length === 0,
    missing,
  };
}

function getRedisRuntimeConfig() {
  const url = readEnv("UPSTASH_REDIS_REST_URL");
  const token = readEnv("UPSTASH_REDIS_REST_TOKEN");

  const errors = [];
  if (!url) errors.push("UPSTASH_REDIS_REST_URL");
  if (!token) errors.push("UPSTASH_REDIS_REST_TOKEN");
  if (url && !url.startsWith("https://")) {
    errors.push("UPSTASH_REDIS_REST_URL_INVALID");
  }

  return {
    ok: errors.length === 0,
    url,
    token,
    errors,
  };
}

function getSiteUrl() {
  const fallback = "https://reeflux.com";
  const raw = readEnv("SITE_URL") || readEnv("URL") || fallback;
  return raw.replace(/\/$/, "");
}

module.exports = {
  getRedisRuntimeConfig,
  getSiteUrl,
  readEnv,
  sanitizeEnvValue,
  validateRequiredEnv,
};
