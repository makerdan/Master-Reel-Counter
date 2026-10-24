"""Read-only content identity check. Not task admission or runtime acceptance."""
from pathlib import Path
import hashlib
import json
import stat
import sys

EXPECTED = "e8b956730577eddd0dc46d48f5c87b041e4047d5a47c83806ac8c34220e5aafe"
ROLES = {'SKILL.md': 'normative', 'reference/installation-contract.md': 'normative', 'tests/policy.test.mjs': 'test', 'README.md': 'explanatory', 'REVISION-NOTES.md': 'explanatory'}
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
    if manifest.get("schemaVersion") != 1 or manifest.get("skillIdentity") != "follow-up-tasks":
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
