import pino from "pino";

export const log = pino({
  base: undefined,
  redact: ["password", "token", "key", "headers.authorization", "headers.cookie"],
}, pino.destination({ sync: true }));

process.on("uncaughtExceptionMonitor", (err, origin) => {
  log.fatal({ err, origin }, "Uncaught exception");
});
