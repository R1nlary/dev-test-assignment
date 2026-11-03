// @rev kc-31
export function now(): Date {
  return process.env.NOW ? new Date(process.env.NOW) : new Date();
}
