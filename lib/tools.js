import { execSync, exec } from "child_process";
import fs from "fs";
import path from "path";

export const tools = {
  read_file: (args) => {
    try {
      const file = args.file || args.path;
      const fullPath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
      return fs.readFileSync(fullPath, "utf-8");
    } catch (e) { return `ERROR: ${e.message}`; }
  },

  write_file: (args) => {
    try {
      const file = args.file || args.path;
      const content = args.content || args.text;
      const fullPath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content);
      return "OK";
    } catch (e) { return `ERROR: ${e.message}`; }
  },

  list_files: (args) => {
    try {
      const pattern = args.pattern || "*";
      const cmd = `find . -type f -name "${pattern.replace(/\*\*/g, "*")}" | grep -v node_modules | grep -v ".git" | head -50`;
      return execSync(cmd, { encoding: "utf-8" });
    } catch { return "No files"; }
  },

  search_code: (args) => {
    try {
      const query = (args.query || args.search || "").replace(/"/g, '\\"');
      const searchPath = args.path || ".";
      const cmd = `grep -r --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.json" -l "${query}" ${searchPath} 2>/dev/null | head -20`;
      return execSync(cmd, { encoding: "utf-8" });
    } catch { return "No matches"; }
  },

  run_command: async (args) => {
    const cmd = args.cmd || args.command;
    const cwd = args.cwd || process.cwd();
    return new Promise((resolve) => {
      const dangerous = ["rm -rf /", "rm -rf /*", "format", "del /f", "mkfs"];
      if (dangerous.some(d => cmd.toLowerCase().includes(d))) {
        resolve("BLOCKED: Dangerous command");
        return;
      }
      exec(cmd, { cwd, shell: true, timeout: 60000 }, (err, stdout, stderr) => {
        resolve(err ? `ERROR: ${err.message}\n${stderr}` : (stdout || stderr || "OK"));
      });
    });
  },

  get_project_context: () => {
    try {
      return execSync(`find . -type f \\( -name "*.ts" -o -name "*.js" -o -name "*.json" \\) | grep -v node_modules | grep -v ".git" | head -40`, { encoding: "utf-8" });
    } catch { return "No project files"; }
  },

  git_status: () => {
    try { return execSync("git status --short 2>/dev/null || echo 'Not a git repo'", { encoding: "utf-8" }); }
    catch { return "Not a git repo"; }
  },

  git_diff: (args) => {
    const full = args?.full || args?.content;
    try { return execSync(full ? "git diff" : "git diff --stat", { encoding: "utf-8" }) || "No changes"; }
    catch { return "No changes"; }
  },

  git_commit: (args) => {
    const msg = args.message || args.msg;
    if (!msg) return "Error: commit message required";
    try {
      execSync("git add -A", { encoding: "utf-8" });
      execSync(`git commit -m "${msg}"`, { encoding: "utf-8" });
      return "Committed successfully";
    } catch (e) { return `Error: ${e.message}`; }
  },

  git_rollback: () => {
    try {
      execSync("git reset --hard HEAD~1", { encoding: "utf-8" });
      return "Rolled back";
    } catch (e) { return `Error: ${e.message}`; }
  },

  git_log: (args) => {
    const count = args?.count || args?.n || 5;
    try { return execSync(`git log --oneline -${count}`, { encoding: "utf-8" }); }
    catch { return "No commits"; }
  },

  git_branch: () => {
    try { return execSync("git branch -a", { encoding: "utf-8" }); }
    catch { return "No branches"; }
  }
};

export const toolDefinitions = [
  { name: "read_file", description: "Read file contents", params: { file: "string" } },
  { name: "write_file", description: "Write content to file", params: { file: "string", content: "string" } },
  { name: "list_files", description: "List files matching pattern", params: { pattern: "string" } },
  { name: "search_code", description: "Search for code pattern", params: { query: "string", path: "string" } },
  { name: "run_command", description: "Execute shell command", params: { cmd: "string", cwd: "string" } },
  { name: "get_project_context", description: "Get project file list", params: {} },
  { name: "git_status", description: "Check git status", params: {} },
  { name: "git_diff", description: "Show git diff", params: { full: "boolean" } },
  { name: "git_commit", description: "Commit changes", params: { message: "string" } },
  { name: "git_rollback", description: "Rollback last commit", params: {} },
  { name: "git_log", description: "Show commit log", params: { count: "number" } },
  { name: "git_branch", description: "Show branches", params: {} }
];

export function plannerPrompt(task) {
  return `Break this task into numbered steps.

Return JSON:
{
  "steps": ["step 1", "step 2"],
  "plan": "brief summary"
}

Task: ${task}`;
}

export async function runParallel(tasks, toolRunner) {
  return await Promise.all(tasks.map(t => toolRunner(t.tool || t.name, t.args || t.params || {})));
}

export function getToolsList() {
  return toolDefinitions.map(t => `- ${t.name}: ${t.description}`).join("\n");
}