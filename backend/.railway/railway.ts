import { defineRailway, project, service } from "railway/iac";

export default defineRailway(() => {
  const api = service("api", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/health/ready",
    healthcheckTimeout: 120,
    deploy: { restartPolicyMaxRetries: 5 },
    replicas: { "us-east4-eqdc4a": 1 },
  });

  return project("Sentinel-SDN", {
    variables: { managed: false },
    resources: [api],
  });
});
