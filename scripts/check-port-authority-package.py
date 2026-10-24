"""Read-only content identity check. Not task admission or runtime acceptance."""
from pathlib import Path
import hashlib
import json
import stat
import sys

EXPECTED = "eed2f79de206ef073f333ad26d541d1096919d3bd445a8fd7b672723f245bc2e"
ROLES = {
    "SKILL.md": "normative",
    "reference/runtime-contract.md": "normative",
    "reference/advanced-controls.md": "normative",
    "reference/symptom-guidance.md": "normative",
    "scripts/free-ports.mjs": "runtime",
    "scripts/validation-lock.mjs": "runtime",
    "scripts/runtime-environment.mjs": "runtime",
    "scripts/host-capabilities.mjs": "runtime",
    "tests/core.test.mjs": "test",
    "tests/hardening.test.mjs": "test",
    "README.md": "explanatory",
    "REVISION-NOTES.md": "explanatory",
    "usage-prompt.txt": "explanatory",
}
IDENTITY = sorted(p for p, role in ROLES.items() if role != "explanatory")
sha = lambda b: hashlib.sha256(b).hexdigest()

def bounded_read(root, name):
    if name != "PACKAGE-MANIFEST.json" and name not in ROLES:
        raise ValueError("Unknown package member")
    target = root / name
    for part in [target, *target.parents]:
        if part.is_symlink():
            raise ValueError("Symlink refused")
    info = target.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 2_000_000:
        raise ValueError("Not a bounded regular file")
    return target.read_bytes()

def verify(directory, expected=EXPECTED):
    root = Path(directory).absolute()
    manifest = json.loads(bounded_read(root, "PACKAGE-MANIFEST.json"))
    if manifest.get("schemaVersion") != 1 or manifest.get("skillIdentity") != "port-authority":
        raise ValueError("Unexpected manifest")
    entries = manifest.get("files", [])
    if len(entries) != len(ROLES) or sorted(e["path"] for e in entries) != sorted(ROLES):
        raise ValueError("Missing, duplicate or unexpected entries")
    if manifest.get("identityFiles") != IDENTITY:
        raise ValueError("Unexpected identity closure")
    hashes = {}
    for entry in entries:
        p = entry["path"]
        b = bounded_read(root, p)
        hashes[p] = sha(b)
        if entry["role"] != ROLES[p] or entry["bytes"] != len(b) or entry["sha256"] != hashes[p]:
            raise ValueError("Member integrity mismatch: " + p)
    actual = sha("".join(p + "\0" + hashes[p] + "\n" for p in IDENTITY).encode())
    if actual != expected or manifest.get("safetyPackageSha256") != actual:
        raise ValueError("Selected safety-package pin mismatch")
    return {"kind": "CONTENT_VERIFIED_ONLY", "safetyPackageSha256": actual,
            "runtimeAcceptanceEstablished": False, "authorizationEstablished": False}

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python verify-package.py PACKAGE_DIRECTORY")
    print(json.dumps(verify(sys.argv[1]), indent=2))
