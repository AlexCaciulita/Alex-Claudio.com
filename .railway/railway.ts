import { defineRailway, github, preserve, project, service } from "railway/iac";

// Do not run `railway config apply` with this file as it stands. It describes only the website
// service; applying it would remove anything it doesn't list, including the PostgreSQL database
// that holds the studio dashboard's inquiries and notes, and variables such as DATABASE_URL and
// ADMIN_PASSWORD. Add those first if this file is ever used to manage the project.
export default defineRailway(() => {
  const alexClaudioSite = service("alex-claudio-site", {
    source: github("AlexCaciulita/Alex-Claudio.com", { checkSuites: false }),
    replicas: { "us-west2": 1 },
    domains: ["alex-claudio.com", "www.alex-claudio.com"],
    deploy: {
      startCommand: "npm start",
      healthcheckPath: "/health",
      healthcheckTimeout: 100,
    },
    env: { R2_ACCESS_KEY_ID: preserve(), R2_ACCOUNT_ID: preserve(), R2_BUCKET_NAME: preserve(), R2_PUBLIC_DOMAIN: preserve(), R2_SECRET_ACCESS_KEY: preserve(), RESEND_API_KEY: preserve() },
  });

  return project("alex-claudio-com", {
    resources: [alexClaudioSite],
  });
});
