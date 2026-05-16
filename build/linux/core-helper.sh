#!/bin/sh

set -eu

RUNTIME_DIR="/run/clash-lite-core"
REQUEST_DIR="$RUNTIME_DIR/requests"
RESPONSE_DIR="$RUNTIME_DIR/responses"
STATE_DIR="$RUNTIME_DIR/state"
HELPER_LOG="$RUNTIME_DIR/helper.log"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RESOURCES_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
CORE_PATH="$RESOURCES_DIR/sidecar/mihomo"

umask 022

mkdir -p "$REQUEST_DIR" "$RESPONSE_DIR" "$STATE_DIR"
chmod 1777 "$REQUEST_DIR"
chmod 0755 "$RUNTIME_DIR" "$RESPONSE_DIR" "$STATE_DIR"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$HELPER_LOG" 2>/dev/null || true
}

get_field() {
  key="$1"
  file="$2"
  sed -n "s/^${key}=//p" "$file" | head -n 1
}

decode_field() {
  value="$1"
  [ -n "$value" ] || return 1
  printf '%s' "$value" | base64 -d 2>/dev/null
}

resolve_path() {
  path="$1"
  if resolved=$(readlink -f -- "$path" 2>/dev/null); then
    printf '%s' "$resolved"
  else
    printf '%s' "$path"
  fi
}

is_under_path() {
  child="$1"
  parent="$2"
  case "$child" in
    "$parent"|"$parent"/*) return 0 ;;
    *) return 1 ;;
  esac
}

is_number() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

get_user_entry() {
  uid="$1"
  getent passwd "$uid" || true
}

user_gid_from_entry() {
  printf '%s' "$1" | cut -d: -f4
}

user_home_from_entry() {
  printf '%s' "$1" | cut -d: -f6
}

write_status() {
  uid="$1"
  gid="$2"
  request_id="$3"
  status="$4"
  message="$5"
  pid="${6:-}"
  user_response_dir="$RESPONSE_DIR/$uid"
  response_file="$user_response_dir/$request_id.status"

  mkdir -p "$user_response_dir"
  {
    printf 'STATUS=%s\n' "$status"
    printf 'MESSAGE=%s\n' "$message"
    [ -z "$pid" ] || printf 'PID=%s\n' "$pid"
  } > "$response_file"
  chmod 0644 "$response_file"
  chown "$uid:$gid" "$user_response_dir" "$response_file" 2>/dev/null || true
}

is_owned_core_pid() {
  pid="$1"
  [ -n "$pid" ] || return 1
  is_number "$pid" || return 1
  [ -d "/proc/$pid" ] || return 1
  [ -r "/proc/$pid/cmdline" ] || return 1
  tr '\000' ' ' < "/proc/$pid/cmdline" | grep -F -- "$CORE_PATH" >/dev/null 2>&1
}

chown_user_path() {
  uid="$1"
  gid="$2"
  target="$3"
  [ -n "$target" ] || return 0
  [ -e "$target" ] || return 0
  chown -R "$uid:$gid" "$target" 2>/dev/null || true
}

stop_core_for_uid() {
  uid="$1"
  gid="$2"
  user_data_dir="${3:-}"
  pid_file="$STATE_DIR/core-$uid.pid"
  data_file="$STATE_DIR/core-$uid.data"

  if [ -z "$user_data_dir" ] && [ -f "$data_file" ]; then
    stored_gid=$(get_field GID "$data_file")
    stored_user_data_dir=$(decode_field "$(get_field USER_DATA_DIR_B64 "$data_file")" || true)
    [ -z "$stored_gid" ] || gid="$stored_gid"
    [ -z "$stored_user_data_dir" ] || user_data_dir="$stored_user_data_dir"
  fi

  if [ -s "$pid_file" ]; then
    pid=$(cat "$pid_file" 2>/dev/null || true)
    if is_owned_core_pid "$pid"; then
      kill -INT "$pid" 2>/dev/null || true
      i=0
      while [ "$i" -lt 50 ] && kill -0 "$pid" 2>/dev/null; do
        sleep 0.1
        i=$((i + 1))
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid" 2>/dev/null || true
        sleep 0.5
      fi
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
      fi
    fi
  fi

  rm -f "$pid_file" "$data_file"

  if [ -n "$user_data_dir" ]; then
    chown_user_path "$uid" "$gid" "$user_data_dir/work"
    chown_user_path "$uid" "$gid" "$user_data_dir/logs"
  fi
}

stop_all_cores() {
  for pid_file in "$STATE_DIR"/core-*.pid; do
    [ -e "$pid_file" ] || continue
    file_name=$(basename -- "$pid_file")
    uid=${file_name#core-}
    uid=${uid%.pid}
    is_number "$uid" || continue
    user_entry=$(get_user_entry "$uid")
    [ -n "$user_entry" ] || continue
    gid=$(user_gid_from_entry "$user_entry")
    stop_core_for_uid "$uid" "$gid"
  done
}

validate_request_paths() {
  uid="$1"
  user_entry="$2"
  user_data_dir="$3"
  work_dir="$4"
  log_path="$5"

  gid=$(user_gid_from_entry "$user_entry")
  home=$(user_home_from_entry "$user_entry")
  [ -n "$gid" ] || return 1
  [ -n "$home" ] || return 1

  home_real=$(resolve_path "$home")
  user_data_real=$(resolve_path "$user_data_dir")
  work_real=$(resolve_path "$work_dir")
  log_dir_real=$(resolve_path "$(dirname -- "$log_path")")

  is_under_path "$user_data_real" "$home_real" || return 1
  is_under_path "$work_real" "$user_data_real" || return 1
  is_under_path "$log_dir_real" "$user_data_real" || return 1

  if [ -e "$user_data_dir" ]; then
    owner=$(stat -c '%u' "$user_data_dir" 2>/dev/null || echo '')
    [ "$owner" = "$uid" ] || return 1
  fi

  return 0
}

start_core_for_request() {
  uid="$1"
  gid="$2"
  user_data_dir="$3"
  work_dir="$4"
  log_path="$5"
  controller_host="$6"
  controller_port="$7"
  secret="$8"

  [ -x "$CORE_PATH" ] || {
    log "core is not executable: $CORE_PATH"
    return 1
  }
  [ "$controller_host" = "127.0.0.1" ] || return 1
  is_number "$controller_port" || return 1
  [ "$controller_port" -ge 1024 ] || return 1
  [ "$controller_port" -le 65535 ] || return 1
  [ -n "$secret" ] || return 1
  [ -d "$work_dir" ] || return 1

  stop_core_for_uid "$uid" "$gid" "$user_data_dir"

  mkdir -p "$(dirname -- "$log_path")"
  touch "$log_path"
  chown "$uid:$gid" "$log_path" 2>/dev/null || true
  chmod 0644 "$log_path" 2>/dev/null || true

  nohup "$CORE_PATH" \
    -d "$work_dir" \
    -ext-ctl "$controller_host:$controller_port" \
    -secret "$secret" \
    >> "$log_path" 2>&1 &

  pid="$!"
  echo "$pid" > "$STATE_DIR/core-$uid.pid"
  user_data_dir_b64=$(printf '%s' "$user_data_dir" | base64 | tr -d '\n')
  {
    printf 'GID=%s\n' "$gid"
    printf 'USER_DATA_DIR_B64=%s\n' "$user_data_dir_b64"
  } > "$STATE_DIR/core-$uid.data"
  sleep 0.2

  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$STATE_DIR/core-$uid.pid"
    return 1
  fi

  log "started mihomo pid=$pid uid=$uid controller=$controller_host:$controller_port"
  printf '%s' "$pid"
}

process_request() {
  request_file="$1"
  [ -f "$request_file" ] || return 0
  [ ! -L "$request_file" ] || {
    rm -f "$request_file"
    return 0
  }

  uid=$(stat -c '%u' "$request_file" 2>/dev/null || echo '')
  is_number "$uid" || {
    rm -f "$request_file"
    return 0
  }

  user_entry=$(get_user_entry "$uid")
  [ -n "$user_entry" ] || {
    rm -f "$request_file"
    return 0
  }
  gid=$(user_gid_from_entry "$user_entry")

  request_id=$(get_field REQUEST_ID "$request_file")
  command=$(get_field COMMAND "$request_file")
  case "$request_id" in
    ''|*[!A-Za-z0-9._-]*) request_id="invalid-$(date +%s)" ;;
  esac

  user_data_dir=$(decode_field "$(get_field USER_DATA_DIR_B64 "$request_file")" || true)
  work_dir=$(decode_field "$(get_field WORK_DIR_B64 "$request_file")" || true)
  log_path=$(decode_field "$(get_field LOG_PATH_B64 "$request_file")" || true)
  secret=$(decode_field "$(get_field SECRET_B64 "$request_file")" || true)
  controller_host=$(get_field CONTROLLER_HOST "$request_file")
  controller_port=$(get_field CONTROLLER_PORT "$request_file")

  case "$command" in
    ping)
      write_status "$uid" "$gid" "$request_id" ok "pong"
      ;;
    stop)
      if [ -n "$user_data_dir" ] && validate_request_paths "$uid" "$user_entry" "$user_data_dir" "${work_dir:-$user_data_dir/work}" "${log_path:-$user_data_dir/logs/core.log}"; then
        stop_core_for_uid "$uid" "$gid" "$user_data_dir"
      else
        stop_core_for_uid "$uid" "$gid"
      fi
      write_status "$uid" "$gid" "$request_id" ok "stopped"
      ;;
    start)
      if ! validate_request_paths "$uid" "$user_entry" "$user_data_dir" "$work_dir" "$log_path"; then
        write_status "$uid" "$gid" "$request_id" error "invalid request paths"
      elif pid=$(start_core_for_request "$uid" "$gid" "$user_data_dir" "$work_dir" "$log_path" "$controller_host" "$controller_port" "$secret"); then
        write_status "$uid" "$gid" "$request_id" ok "started" "$pid"
      else
        write_status "$uid" "$gid" "$request_id" error "failed to start core"
      fi
      ;;
    *)
      write_status "$uid" "$gid" "$request_id" error "unknown command"
      ;;
  esac

  rm -f "$request_file"
}

SHUTTING_DOWN=0
shutdown_helper() {
  [ "$SHUTTING_DOWN" -eq 0 ] || return 0
  SHUTTING_DOWN=1
  stop_all_cores
}

trap 'shutdown_helper; exit 0' INT TERM
trap 'shutdown_helper' EXIT

log "helper started"

while :; do
  for request_file in "$REQUEST_DIR"/*.env; do
    [ -e "$request_file" ] || continue
    process_request "$request_file" || log "failed to process request: $request_file"
  done
  sleep 0.2
done
