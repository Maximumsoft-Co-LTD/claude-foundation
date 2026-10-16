"use strict";

class ServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ServiceError";
  }
}

const DNS_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

function validate(service) {
  if (!service || typeof service !== "object") throw new ServiceError("service must be an object");
  if (typeof service.name !== "string" || !DNS_LABEL.test(service.name)) throw new ServiceError("name must be a DNS label");
  if (typeof service.image !== "string" || service.image === "") throw new ServiceError("image is required");
  if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535)
    throw new ServiceError("port must be an integer from 1 to 65535");
  if (service.replicas !== undefined && (!Number.isInteger(service.replicas) || service.replicas < 1))
    throw new ServiceError("replicas must be a positive integer");
}

function buildManifest(service) {
  validate(service);
  const labels = { app: service.name, team: service.team || "platform" };
  const env = Object.entries(service.env || {}).map(([name, value]) => ({ name, value: String(value) }));
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: service.name, labels },
    spec: {
      replicas: service.replicas ?? 2,
      selector: { matchLabels: { app: service.name } },
      template: {
        metadata: { labels },
        spec: {
          containers: [{
            name: service.name,
            image: service.image,
            ports: [{ containerPort: service.port, protocol: "TCP" }],
            env
          }]
        }
      }
    }
  };
}

module.exports = { buildManifest, ServiceError };
