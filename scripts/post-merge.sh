#!/bin/bash
set -e
npm install
bash scripts/guard-drizzle-push.sh
