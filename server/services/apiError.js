class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireUuid(value, name = "id") {
  if (typeof value !== "string" || !UUID.test(value)) throw new ApiError(400, "INVALID_INPUT", `Invalid ${name}`);
  return value;
}
function requireString(value, name, max = 255) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ApiError(400, "INVALID_INPUT", `Invalid ${name}`);
  }
  return value.trim();
}
function dbResult(result) {
  if (result.error) throw result.error;
  return result.data;
}

module.exports = { ApiError, requireUuid, requireString, dbResult };
