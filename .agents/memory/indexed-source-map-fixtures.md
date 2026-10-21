---
name: Indexed source-map fixture compatibility
description: Keep source-map-js offset-security tests separate from existing indexed-consumer helper limitations.
---

For source-map-js indexed-map fixtures, consume mappings with `eachMapping` and
add them to a generator explicitly when testing a valid serialization path.
Use a basic consumer for `SourceMapGenerator.fromSourceMap` positive controls.
Keep malformed-offset rejection assertions independent of those positive paths.

**Why:** The indexed consumer lacks the basic consumer's source-root metadata,
so direct `fromSourceMap` conversion can fail for an otherwise valid indexed map.
Its first-column position lookup also has an existing offset quirk. These
unrelated helper behaviors initially obscured a passing offset-security repair.

**How to apply:** When upgrading this parser, distinguish failures of security
rejection from positive-fixture API assumptions. Do not relax negative controls
or change application behavior merely to accommodate a fixture helper.
