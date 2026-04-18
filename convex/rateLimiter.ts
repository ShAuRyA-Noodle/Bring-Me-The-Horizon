// Per-user rate limiter for user-initiated question sending.
import { RateLimiter, HOUR } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  sendQuestion: {
    kind: "token bucket",
    rate: 30,
    period: HOUR,
    capacity: 30,
  },
});
