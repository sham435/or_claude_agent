#!/usr/bin/env node
import readline from "readline";
import fetch from "node-fetch";
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { tools, toolDefinitions } from "./lib/tools.js";

const home = process.env.HOME || process.env.USERPROFILE;
const configPath = path.join(home, ".or_claude", "settings.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const { ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_BASE_URL, OLLAMA_MODEL } = config;
const PROJECT_ROOT = process.cwd();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

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

async function callOpenRouter(messages) {
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
    return data.choices?.[0]?.message?.content || "";
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

function callOllama(prompt) {
  return new Promise((resolve) => {
    const model = OLLAMA_MODEL || "deepseek-r1:8b";
    const proc = spawn("ollama", ["run", model, prompt], { 
      cwd: PROJECT_ROOT,
      shell: true 
    });
    
    let output = "";
    const timeout = setTimeout(() => {
      proc.kill();
      resolve(output || "Timeout");
    }, 60000);
    
    proc.stdout.on("data", (data) => {
      process.stdout.write(data.toString());
      output += data.toString();
    });
    
    proc.stderr.on("data", (data) => output += data.toString());
    
    proc.on("close", () => { clearTimeout(timeout); resolve(output); });
    proc.on("error", (e) => { clearTimeout(timeout); resolve(`Error: ${e.message}`); });
  });
}

async function executeTool(toolName, args) {
  const fn = tools[toolName];
  if (!fn) return `Unknown tool: ${toolName}`;
  try {
    if (toolName === "run_command") return await fn(args.cmd, args.cwd);
    if (toolName === "git_commit") return fn(args.msg);
    if (toolName === "ast_edit") return fn(args.file, args.fn, args.body);
    if (toolName === "add_import") return fn(args.file, args.importStmt);
    return fn(args);
  } catch (e) { return `Error: ${e.message}`; }
}

function systemPrompt(files, gitStatus) {
  return `You are or_claude, an autonomous coding agent like Claude Code.

Available tools:
${toolDefinitions.map(t => `- ${t}`).join("\n")}

Project: ${PROJECT_ROOT}
Git status: ${gitStatus || "clean"}

Project files:
${files.substring(0, 2000)}

When user asks to do something:
1. Explore with list_files, search_code
2. Read files with read_file
3. Make changes with write_file or ast_edit
4. Run commands with run_command
5. Commit with git_commit

IMPORTANT: Respond in JSON format:
{ "type": "tool"|"final", "tool": "name", "args": {}, "reasoning": "", "output": "" }

For tool calls use type: "tool", for final answer use type: "final".`;
}

async function runAgentLoop(task) {
  const files = getProjectContext();
  const gitStatus = getGitStatus();
  const systemMsg = { role: "system", content: systemPrompt(files, gitStatus) };
  
  let messages = [
    systemMsg,
    { role: "user", content: task }
  ];

  console.log(`\n[or_claude] ${task}\n`);

  for (let step = 0; step < 12; step++) {
    console.log(`[Step ${step + 1}]`);
    
    let response;
    try {
      response = await callOpenRouter(messages);
    } catch (e) {
      if (e.message.includes("Rate limit") || e.name === "AbortError") {
        console.log("[Using local Ollama...]\n");
        await callOllama(messages.map(m => `${m.role}: ${m.content}`).join("\n"));
        return;
      }
      console.log(`Error: ${e.message}`);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(response);
    } catch {
      console.log(response);
      continue;
    }

    if (parsed.type === "final") {
      console.log("\n" + "=".repeat(40));
      console.log(parsed.output || response);
      return;
    }

    if (parsed.tool && tools[parsed.tool]) {
      console.log(`→ ${parsed.tool}`, JSON.stringify(parsed.args || {}).substring(0, 60));
      
      const result = await executeTool(parsed.tool, parsed.args || {});
      console.log(`  Result: ${String(result).substring(0, 150)}`);
      
      messages.push({ role: "assistant", content: response });
      messages.push({ role: "user", content: `Result: ${String(result).substring(0, 1500)}` });
    }
  }
  console.log("\n[Max steps reached]");
}

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
    await runAgentLoop(task);
    console.log("");
  }
  rl.close();
}

main();