import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { tools, toolDefinitions } from "./tools.js";

const home = process.env.HOME || process.env.USERPROFILE;
const configPath = path.join(home, ".or_claude", "settings.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const { ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_BASE_URL, OLLAMA_MODEL } = config;

const API = `${ANTHROPIC_BASE_URL}/v1/chat/completions`;
const MODEL = ANTHROPIC_MODEL || "qwen/qwen3.6-plus-preview:free";

function systemPrompt(projectFiles = "") {
  return `
You are or_claude, an autonomous coding agent that lives in the terminal.

You MUST respond in valid JSON format only. No other text.

Available tools:
${toolDefinitions.map(t => `- ${t.name}: ${t.description}`).join("\n")}

Project files:
${projectFiles}

IMPORTANT: For every task:
1. First explore the project to understand structure
2. Find relevant files using search_code/list_files
3. Read the files to understand the code
4. Make the necessary changes
5. Verify with run_command if needed

Return JSON format:
{
  "type": "tool" | "final",
  "tool": "tool_name",
  "args": { "param": "value" },
  "reasoning": "why I'm doing this",
  "output": "final answer or tool result"
}

For tool calls, respond with type: "tool".
For final answer, respond with type: "final".
`;
}

let currentProcess = null;

async function callLLM(messages, useOllama = false) {
  if (useOllama) {
    const { spawn } = await import("child_process");
    return new Promise((resolve, reject) => {
      const model = OLLAMA_MODEL || "deepseek-r1:8b";
      const prompt = messages.map(m => `${m.role}: ${m.content}`).join("\n\n");
      const proc = spawn("ollama", ["run", model], { shell: true });
      proc.stdin.write(prompt);
      proc.stdin.end();
      let output = "";
      proc.stdout.on("data", (data) => output += data.toString());
      proc.stderr.on("data", (data) => output += data.toString());
      proc.on("close", () => resolve({ content: output }));
      proc.on("error", reject);
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ANTHROPIC_API_KEY}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.2
      })
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (data?.error?.code === 429) throw new Error("Rate limit");
    return data.choices?.[0]?.message || { content: "" };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function executeTool(toolName, args) {
  const toolFn = tools[toolName];
  if (!toolFn) return `ERROR: Unknown tool ${toolName}`;
  
  try {
    const result = await toolFn(args);
    return result;
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

export async function runAgent(task, maxSteps = 15) {
  const projectFiles = tools.get_project_context();
  
  let messages = [
    { role: "system", content: systemPrompt(projectFiles) },
    { role: "user", content: task }
  ];

  console.log(`\n[Agent] Starting: ${task}\n`);

  for (let i = 0; i < maxSteps; i++) {
    console.log(`[Step ${i + 1}/${maxSteps}]`);
    
    let msg;
    let usedOllama = false;
    
    try {
      msg = await callLLM(messages);
    } catch (err) {
      console.log(`Cloud error: ${err.message}`);
      console.log("[Trying local Ollama...]");
      try {
        msg = await callLLM(messages, true);
        usedOllama = true;
      } catch (e2) {
        console.log(`Ollama error: ${e2.message}`);
        break;
      }
    }

    if (!msg.content || !msg.content.trim()) {
      console.log("Empty response from model");
      break;
    }

    let parsed;
    try {
      parsed = JSON.parse(msg.content);
    } catch {
      console.log("Response:", msg.content.substring(0, 300));
      console.log("\n[Non-JSON response - treating as final answer]");
      console.log(msg.content);
      break;
    }

    if (parsed.type === "final") {
      console.log("\n" + "=".repeat(40));
      console.log("RESULT:");
      console.log("=".repeat(40));
      console.log(parsed.output || msg.content);
      return parsed.output || msg.content;
    }

    if (parsed.type === "tool" && parsed.tool) {
      console.log(`→ ${parsed.tool}`, JSON.stringify(parsed.args || {}).substring(0, 50));
      console.log(`  Reasoning: ${parsed.reasoning || "none"}`);
      
      const result = await executeTool(parsed.tool, parsed.args || {});
      
      console.log(`  Result: ${result.toString().substring(0, 150)}`);
      
      messages.push({ role: "assistant", content: msg.content });
      messages.push({ 
        role: "user", 
        content: `Tool result for ${parsed.tool}:\n${result.toString().substring(0, 2000)}` 
      });
    }
  }

  console.log("\n[Agent] Max steps reached");
  return "Task incomplete - max steps reached";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const task = process.argv.slice(2).join(" ");
  if (!task) {
    console.log("Usage: node agent.js <task>");
    process.exit(1);
  }
  runAgent(task).then(console.log).catch(console.error);
}