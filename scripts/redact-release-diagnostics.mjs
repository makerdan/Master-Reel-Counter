import { pathToFileURL } from "node:url";

const SENSITIVE_ASSIGNMENT =
  /(?:authorization|cookie|password|token|secret|session|api[\s_-]*key|publishable[\s_-]*key|request[\s_-]*body|response[\s_-]*body)/i;
const CREDENTIAL_SHAPE =
  /(?:\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]+|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/gi;
const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/gi;
const PRIVATE_KEY_START = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/i;
const STRUCTURED_PAYLOAD_LINE = /^\s*[[{"]|^\s*"[A-Za-z0-9_.-]+"\s*:/;

export function redactReleaseDiagnostics(input) {
  let bodyStarted = false;
  let privateKeyStarted = false;
  return input
    .replace(PRIVATE_KEY_BLOCK, "[REDACTED PRIVATE KEY]")
    .split(/\r?\n/)
    .map((line) => {
      if (privateKeyStarted) return "[REDACTED PRIVATE KEY CONTENT]";
      if (PRIVATE_KEY_START.test(line)) {
        privateKeyStarted = true;
        return "[REDACTED PRIVATE KEY CONTENT]";
      }
      if (bodyStarted) return "[REDACTED BODY CONTENT]";
      if (/(?:request|response)[\s_-]*body/i.test(line)) {
        bodyStarted = true;
        return "[REDACTED BODY CONTENT]";
      }
      if (SENSITIVE_ASSIGNMENT.test(line) || STRUCTURED_PAYLOAD_LINE.test(line)) {
        return "[REDACTED UNSAFE LINE]";
      }
      return line
        .replace(
          /([?&][^=\s&]+)=([^&\s]*)/g,
          "$1=[REDACTED]",
        )
        .replace(CREDENTIAL_SHAPE, "[REDACTED]");
    })
    .join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(redactReleaseDiagnostics(input));
}