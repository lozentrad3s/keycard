import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// One .env at the repo root serves the scripts and the web app locally.
const rootEnv = resolve(__dirname, "../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = { reactStrictMode: true };
export default config;
