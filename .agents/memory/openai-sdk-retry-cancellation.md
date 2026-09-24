---
name: OpenAI SDK retry cancellation
description: Cancellation-sensitive provider requests must not rely on the SDK's built-in retry delay.
---

For cancellation-sensitive OpenAI JavaScript requests, disable SDK-managed retries and own the bounded retry loop when the request's caller must be able to stop retry waits. Pass the caller's signal to each provider attempt and make the application-owned delay reject promptly on abort.

**Why:** The SDK's retry path waits on a plain timer. An aborted request can therefore keep waiting and hold application resources before attempting the provider again.

**How to apply:** When provider capacity or client disconnect handling depends on prompt cancellation, verify retry-delay behavior with a real SDK call against a mocked rate-limit response; abort after the response and assert no later request is sent.