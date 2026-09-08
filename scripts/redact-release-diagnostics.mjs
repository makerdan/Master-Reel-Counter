import { pathToFileURL } from "node:url";

export function redactReleaseDiagnostics(input) {
  return input
    .replace(
      /\b(authorization|cookie|set-cookie)\s*:\s*[^\r\n]*/gi,
      "$1: [REDACTED]",
    )
    .replace(
      /([?&](?:__clerk_testing_token|token|password|secret|session|cookie)=)[^&\s]*/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b((?:token|password|secret|session|cookie)[^=:\r\n]*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[REDACTED]",
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(redactReleaseDiagnostics(input));
}