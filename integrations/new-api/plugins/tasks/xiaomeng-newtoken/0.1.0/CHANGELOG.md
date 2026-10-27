---
changelogVersion: 1
plugin: "xiaomeng-newtoken"
version: "0.1.0"
locale: "en"
---
# Changelog

## [0.1.0]
### Added

- Connect NewToken's native task API for Seedance 2.0, Fast, Mini and 2.5 through the `/xiaomeng-newtoken/api/v3/contents/generations/tasks` routes.
- Apply the account group's 720p/1080p limits to each model: Fast and Mini accept only 720p, while 2.0 and 2.5 also accept 1080p.
- Validate model-specific durations and reference counts, and select ordinary reference generation for Seedance 2.5 video references.
- Reserve 500,000 tokens and settle task usage expressions using only valid `usage.total_tokens`, with separate reference-video pricing facts.
- Preserve generated results with `billing_status: pending_usage` while token usage is unavailable and continue polling before the host timeout.
