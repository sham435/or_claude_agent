#!/usr/bin/env node
import express from "express";
import readline from "readline";
import fetch from "node-fetch";
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { tools, toolDefinitions, getToolsList } from "./lib/tools.js";

const home = process.env.HOME || process.env.USERPROFILE;
const configPath = path.join(home, ".or_claude", "settings.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const { ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_BASE_URL, OLLAMA_MODEL } = config;
const PROJECT_ROOT = process.cwd();

const app = express();
app.use(express.json());

function getProjectContext() {
  try {
    return execSync(`find . -type f \\( -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.json" \\) | grep -v node_modules | grep -v ".git" | head -50`, 
      { cwd: PROJECT_ROOT, encoding: "utf-8" });
  } catch { return "No project files"; }
}

function getGitStatus() {
  try { return execSync("git status --short", { cwd: PROJECT_ROOT, encoding: "utf-8" }) || "Clean"; }
  catch { return ""; }
}

async function callLLM(messages, useOllama = false) {
  if (useOllama) {
    return new Promise((resolve) => {
      const model = OLLAMA_MODEL || "deepseek-r1:8b";
      const prompt = messages.map(m => `${m.role}: ${m.content}`).join("\n\n");
      const proc = spawn("ollama", ["run", model, prompt], { cwd: PROJECT_ROOT, shell: true, timeout: 60000 });
      let output = "";
      const timeout = setTimeout(() => { proc.kill(); resolve({ content: output || "Timeout" }); }, 60000);
      proc.stdout.on("data", d => { process.stdout.write(d.toString()); output += d.toString(); });
      proc.stderr.on("data", d => output += d.toString());
      proc.on("close", () => { clearTimeout(timeout); resolve({ content: output }); });
      proc.on("error", e => { clearTimeout(timeout); resolve({ content: `Error: ${e.message}` }); });
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${ANTHROPIC_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${ANTHROPIC_API_KEY}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: ANTHROPIC_MODEL, messages, temperature: 0.2 })
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (data?.error?.code === 429) throw new Error("Rate limit");
    return data.choices?.[0]?.message || { content: "" };
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

async function executeTool(toolName, args) {
  const fn = tools[toolName];
  if (!fn) return `Unknown tool: ${toolName}`;
  try {
    return await fn(args);
  } catch (e) { return `Error: ${e.message}`; }
}

function systemPrompt(files, gitStatus) {
  return `You are or_claude, an autonomous coding agent like Claude Code.

Available tools:
${getToolsList()}

Project: ${PROJECT_ROOT}
Git status: ${gitStatus || "clean"}

Project files:
${files.substring(0, 2000)}

When user asks to do something:
1. Explore with list_files, search_code
2. Read files with read_file
3. Make changes with write_file
4. Run commands with run_command
5. Commit with git_commit

IMPORTANT: Respond in JSON format:
{ "type": "tool"|"final", "tool": "name", "args": {}, "reasoning": "", "output": "" }

For tool calls use type: "tool", for final answer use type: "final".`;
}

export async function runAgent(task, maxSteps = 12) {
  const files = getProjectContext();
  const gitStatus = getGitStatus();
  
  let messages = [
    { role: "system", content: systemPrompt(files, gitStatus) },
    { role: "user", content: task }
  ];

  console.log(`\n[or_claude] ${task}\n`);

  for (let step = 0; step < maxSteps; step++) {
    console.log(`[Step ${step + 1}/${maxSteps}]`);
    
    let response;
    try {
      response = await callLLM(messages);
    } catch (e) {
      if (e.message.includes("Rate limit") || e.name === "AbortError") {
        console.log("[Using local Ollama...]\n");
        response = await callLLM(messages, true);
      } else {
        return `Error: ${e.message}`;
      }
    }

    let parsed;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      console.log(response.content);
      continue;
    }

    if (parsed.type === "final") {
      console.log("\n" + "=".repeat(40));
      return parsed.output || response.content;
    }

    if (parsed.tool && tools[parsed.tool]) {
      console.log(`→ ${parsed.tool}`, JSON.stringify(parsed.args || {}).substring(0, 60));
      const result = await executeTool(parsed.tool, parsed.args || {});
      console.log(`  Result: ${String(result).substring(0, 150)}`);
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: `Result: ${String(result).substring(0, 1500)}` });
    }
  }
  return "Max steps reached";
}

// REST API endpoints
app.post("/run", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "Task required" });
  
  try {
    const result = await runAgent(task);
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/status", (req, res) => {
  res.json({ 
    project: PROJECT_ROOT, 
    tools: toolDefinitions.length,
    model: ANTHROPIC_MODEL,
    ollama: OLLAMA_MODEL
  });
});

// CLI mode
if (process.argv.includes("--server")) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`or_claude API running on http://localhost:${port}`));
} else if (process.argv.includes("--web")) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>or_claude</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 2rem auto; padding: 1rem; }
    #task { width: 70%; padding: 0.5rem; font-size: 1rem; }
    #run { padding: 0.5rem 1rem; font-size: 1rem; }
    #output { white-space: pre-wrap; background: #f5f5f5; padding: 1rem; margin-top: 1rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>or_claude</h1>
  <input id="task" placeholder="Enter task..." />
  <button id="run">Run</button>
  <pre id="output"></pre>
  <script>
    document.getElementById("run").onclick = async () => {
      const task = document.getElementById("task").value;
      const out = document.getElementById("output");
      out.textContent = "Running...";
      const res = await fetch("/run", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ task })
      });
      const data = await res.json();
      out.textContent = data.result || data.error;
    };
  </script>
</body>
</html>`;
  app.get("/", (req, res) => res.send(html));
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`or_claude UI: http://localhost:${port}`));
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  function ask(q) { return new Promise(r => rl.question(q, r)); }
  
  async function main() {
    console.log("=".repeat(50));
    console.log("  or_claude agent (Claude Code-like)");
    console.log("=".repeat(50));
    console.log(`Project: ${PROJECT_ROOT}`);
    console.log(`Tools: ${toolDefinitions.length} available`);
    console.log("Type 'exit' to quit\n");

    while (true) {
      const task = await ask("Task> ");
      if (["exit", "quit"].includes(task.toLowerCase())) break;
      if (!task.trim()) continue;
      const result = await runAgent(task);
      console.log("\n" + result + "\n");
    }
    rl.close();
  }
  main();
}