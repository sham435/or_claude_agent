#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const home = process.env.HOME || process.env.USERPROFILE;
const configPath = path.join(home, ".or_claude", "settings.json");

if (!fs.existsSync(configPath)) {
  console.error("Config not found at ~/.or_claude/settings.json");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const { ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_BASE_URL } = config;

if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is missing in config");
  process.exit(1);
}

const argv = yargs(hideBin(process.argv))
  .usage("Usage: $0 run <prompt>")
  .option("local", {
    alias: "l",
    type: "boolean",
    description: "Force local Ollama",
    default: false
  })
  .command("run <prompt>", "Run a prompt through Claude", yargs => {
    yargs.positional("prompt", {
      describe: "Prompt text",
      type: "string",
    });
  })
  .demandCommand()
  .argv;

function isOllamaAvailable() {
  return new Promise((resolve) => {
    const proc = spawn("ollama", ["list"], { shell: true });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

async function runOllama(prompt) {
  return new Promise((resolve, reject) => {
    const model = config.OLLAMA_MODEL || "llama3.2";
    const proc = spawn("ollama", ["run", model, prompt], { shell: true, stdio: "inherit" });
    proc.on("close", (code) => resolve(""));
    proc.on("error", reject);
  });
}

async function runOpenRouter(prompt) {
  const res = await fetch(`${ANTHROPIC_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ANTHROPIC_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL || "qwen/qwen3.6-plus-preview:free",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
    }),
  });

  const data = await res.json();
  if (data?.error?.code === 429) {
    throw new Error("Rate limit exceeded");
  }
  if (data?.choices?.[0]?.message?.content) {
    return data.choices[0].message.content;
  }
  throw new Error(JSON.stringify(data));
}

async function runClaude(prompt, forceLocal) {
  if (forceLocal) {
    console.log("[Using local Ollama]");
    return runOllama(prompt);
  }

  try {
    console.log("[Using OpenRouter]");
    return await runOpenRouter(prompt);
  } catch (err) {
    if (err.message.includes("429") || err.message.includes("Rate limit")) {
      console.log("[OpenRouter rate limited, checking for local Ollama...]");
      const available = await isOllamaAvailable();
      if (available) {
        console.log("[Using local Ollama]");
        return runOllama(prompt);
      }
      console.error("Rate limit exceeded and Ollama not available");
      process.exit(1);
    }
    throw err;
  }
}

const command = argv._[0];
if (command === "run") {
  runClaude(argv.prompt, argv.local).then(console.log).catch(console.error);
}