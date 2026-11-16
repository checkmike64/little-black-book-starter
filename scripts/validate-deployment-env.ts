import { validateDeploymentEnvironment } from "../lib/deployment-environment.ts";

const forceProduction = process.argv.includes("--production");
const result = validateDeploymentEnvironment(process.env, {
  production: forceProduction || process.env.VERCEL_ENV === "production",
});

if (!result.production) {
  console.log("Deployment environment validation skipped outside production.");
  process.exit(0);
}

if (!result.valid) {
  console.error("Production deployment environment is not ready:");
  for (const issue of result.issues) {
    console.error(`- ${issue.message}`);
  }
  process.exit(1);
}

console.log("Production deployment environment is ready.");
