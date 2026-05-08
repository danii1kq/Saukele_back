const rateLimit = require("express-rate-limit");

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts, please try again in a minute" },
});

module.exports = {
  authLimiter,
};
