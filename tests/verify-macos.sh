#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/x2obsidian-swift.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
xcrun swiftc -swift-version 5 desktop/CaptureCore.swift tests/native/main.swift -o "$TEST_DIR/validate"
"$TEST_DIR/validate"
xcrun swiftc -swift-version 5 -typecheck desktop/CaptureCore.swift desktop/main.swift -framework AppKit
