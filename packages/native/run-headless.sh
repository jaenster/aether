#!/bin/bash
# Run in headless mode — same as run.sh but forces --headless
exec "$(dirname "$0")/run.sh" --headless "$@"
