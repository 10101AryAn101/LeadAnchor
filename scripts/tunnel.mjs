// Opens the public address in TUNNEL_URL (ngrok's free fixed domain) to the API on port 4000,
// so WhatsApp, Telnyx, Stripe and Resend can deliver their webhooks to this computer.
// Only the API is exposed, not the web app. Setup: docs/integrations/test-mode-setup.md
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, "apps/api/.env");
const setting = (name) => {
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
};

const tunnelUrl = setting("TUNNEL_URL");
if (!tunnelUrl) {
  console.error(
    "Set TUNNEL_URL in apps/api/.env to your free ngrok domain, e.g. https://quiet-otter-123.ngrok-free.app\n" +
      "(ngrok dashboard → Domains). Steps: docs/integrations/test-mode-setup.md",
  );
  process.exit(1);
}
const domain = new URL(tunnelUrl).host;
const port = setting("API_PORT") ?? "4000";

console.log(
  `Forwarding https://${domain} → http://localhost:${port} (the API). Press Ctrl+C to stop.`,
);
const ngrok = spawn("ngrok", ["http", `--url=${domain}`, port], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
const installHint =
  "If ngrok isn't installed: `winget install ngrok.ngrok`, then `ngrok config add-authtoken <token>` once.";
ngrok.on("error", () => {
  console.error(installHint);
  process.exit(1);
});
ngrok.on("exit", (code) => {
  // On Windows a missing ngrok shows up here, as the shell's own "not recognized" error.
  if (code) console.error(`\nngrok stopped. ${installHint}`);
  process.exit(code ?? 0);
});
