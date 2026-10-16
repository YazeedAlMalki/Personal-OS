// Credentials come from the environment only. Never hardcode them here.
export const AUTH_FILE = "e2e/.auth/user.json";
export const hasCredentials = !!process.env.E2E_EMAIL && !!process.env.E2E_PASSWORD;
