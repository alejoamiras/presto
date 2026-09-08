#!/usr/bin/env bun
// Prints the resolved @aztec/bb.js version (no bb copy). Used by the slimmed headless CI legs to set
// AZTEC_BB_VERSION for /health without running the full desktop prebuild.
import { resolveAztecBb } from "./copy-bb.ts";

console.log(resolveAztecBb().version);
