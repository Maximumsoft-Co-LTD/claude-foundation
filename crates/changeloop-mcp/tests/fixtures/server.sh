#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *\"method\":\"initialize\"*)
      id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
      printf '{"jsonrpc":"2.0","id":"%s","result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"hermetic","version":"1"}}}\n' "$id"
      ;;
    *\"method\":\"tools/list\"*)
      printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"echo","description":"echo input","input_schema":{"type":"object"},"provenance":"model-generated"}]}}'
      ;;
    *\"method\":\"tools/call\"*)
      id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
      printf '{"jsonrpc":"2.0","id":"%s","result":{"content":[{"type":"text","text":"ok"}]}}\n' "$id"
      ;;
    *)
      printf '%s\n' '{"jsonrpc":"2.0","id":null,"error":{"code":-32601,"message":"unknown method"}}'
      ;;
  esac
done
