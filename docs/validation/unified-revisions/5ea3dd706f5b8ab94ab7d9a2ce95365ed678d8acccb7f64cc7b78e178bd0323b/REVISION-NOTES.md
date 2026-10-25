# Bounded recovery and maintenance acceptance revision

This revision builds on the host-portable execution package with normative fingerprint
1c473ac807c45b104d7ca36fd94163ae3d0d4d4e97dbb5dd71bc8a81b98a6736.
The core and planning/publication reference are unchanged.

The maintenance reference now makes environment comparison the first diagnostic
step, distinguishes task-executor idleness from unrelated running services, and
provides a bounded decision path when complete authoritative state is inaccessible.
It permits owner-directed maintenance closure with acceptance explicitly deferred,
without relabeling failed checks or enabling unsupported capabilities.

No particular database, ID format, central allocator or transfer architecture is
required. Future operation after acknowledged loss is not restoration and needs
separate authorization. Existing identity, preservation, admission and workload
guarantees remain binding, as do historical contracts and explicit owner requirements.

No task-specific waiver is shipped. No per-test retry filter is added.
No project, runner, ledger, policy or library was modified by this delivery.
Package checks establish text structure, preservation, links and archive integrity,
not runtime enforcement or successful adoption.
