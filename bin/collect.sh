#!/bin/sh
set -eu
export NODE_USE_ENV_PROXY=1
export NO_PROXY="${NO_PROXY:+$NO_PROXY,}${no_proxy:+$no_proxy,}localhost,127.0.0.1,::1"
export no_proxy="$NO_PROXY"
exec node "$(dirname "$0")/../collector/run.ts" "$@"
