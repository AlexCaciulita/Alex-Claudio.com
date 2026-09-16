import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const alexClaudioSite = service("alex-claudio-site", {
    source: github("AlexCaciulita/Alex-Claudio.com", { checkSuites: false }),
    replicas: { "us-west2": 1 },
    deploy: {
      startCommand: "npm start",
      healthcheckPath: "/health",
      healthcheckTimeout: 100,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
    env: { R2_ACCESS_KEY_ID: preserve(), R2_ACCOUNT_ID: preserve(), R2_BUCKET_NAME: preserve(), R2_PUBLIC_DOMAIN: preserve(), R2_SECRET_ACCESS_KEY: preserve(), RESEND_API_KEY: preserve() },
  });

  return project("alex-claudio-com", {
    resources: [alexClaudioSite],
  });
});
