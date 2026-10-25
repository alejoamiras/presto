// Runtime built-ins only: the credentialed `publish` job in `_publish-npm.yml` imports this.

/**
 * npm's own timeouts do not bound a registry, or a proxy, that accepts the connection and never
 * answers: such an install was still waiting after 25 minutes. A cold install and audit of the
 * largest package take about 30 s.
 */
export const NPM_TIMEOUT_MS = 180_000;

/** `command`'s piped result; throws, naming the command, when it outlives the deadline. */
export function spawnBounded(command: string[], cwd?: string, timeoutMs = NPM_TIMEOUT_MS) {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  if (result.exitedDueToTimeout) {
    throw new Error(`${command.join(" ")} gave no answer within ${timeoutMs / 1000} s`);
  }
  return result;
}

export function run(command: string[], cwd?: string, timeoutMs = NPM_TIMEOUT_MS): string {
  const result = spawnBounded(command, cwd, timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed (${result.exitCode}): ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout.toString();
}
