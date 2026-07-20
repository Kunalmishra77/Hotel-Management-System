# ADR-0004: Mobile-first PWA instead of native apps

- **Status:** Accepted
- **Date:** 2026-07-18

## Context
§16 requires the software to work on Windows laptop, Android, iPhone, and tablet with instant sync. Native apps for each platform triple the build/maintenance cost.

## Decision
Ship a single **mobile-first PWA** (installable, service worker, offline for housekeeping status, background sync). Realtime via LISTEN/NOTIFY→SSE. One codebase serves all four device classes.

## Consequences
- (+) One codebase, all devices; installable; offline where it matters; far cheaper.
- (+) A native shell can wrap the PWA later with no re-architecture if store presence is wanted.
- (−) Some deep-native features (hardware, push on iOS historically) are constrained; acceptable for this scope.

## Alternatives
- React Native / Flutter native apps — cost and duplication unjustified for internal ops tooling; rejected now.
