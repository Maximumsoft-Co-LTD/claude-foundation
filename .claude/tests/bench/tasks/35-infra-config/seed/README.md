# deploygen

Generates Kubernetes Deployment manifests from small service descriptions
(Node.js, no dependencies). The platform pipeline applies the generated JSON
with `kubectl apply -f -`, and a policy check diffs it against the previous
release, so any field that changes must be intended.

```text
node bin/render.js services/<name>.json   # prints the manifest JSON to stdout
```

`buildManifest(service)` from `src/manifest.js` returns the manifest object.

## Service description

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | DNS label, used for metadata, labels and the container name |
| `image` | yes | container image reference |
| `port` | yes | container port (integer 1-65535) |
| `replicas` | no | default 2 |
| `env` | no | object of environment variables |
| `team` | no | owner label, default `"platform"` |

Invalid descriptions throw `ServiceError` and the CLI exits with code 1.
