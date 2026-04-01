import { execSync, exec } from "child_process";
import fs from "fs";
import path from "path";

export const tools = {
  read_file: ({ file }) => {
    try {
      const fullPath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
      return fs.readFileSync(fullPath, "utf-8");
    } catch (e) {
      return `ERROR: ${e.message}`;
    }
  },

  write_file: ({ file, content }) => {
    try {
      const fullPath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content);
      return "OK";
    } catch (e) {
      return `ERROR: ${e.message}`;
    }
  },

  list_files: ({ pattern = "**/*" }) => {
    try {
      const cmd = `find . -type f -name "${pattern.replace(/\*\*/g, "*")}" | grep -v node_modules | grep -v ".git" | head -50`;
      return execSync(cmd, { encoding: "utf-8" });
    } catch (e) {
      return "No files found";
    }
  },

  search_code: ({ query, path: searchPath = "." }) => {
    try {
      const safeQuery = query.replace(/"/g, '\\"');
      const cmd = `grep -r --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.json" -l "${safeQuery}" ${searchPath} 2>/dev/null | head -20`;
      return execSync(cmd, { encoding: "utf-8" });
    } catch (e) {
      return "No matches";
    }
  },

  run_command: ({ cmd, cwd }) => {
    return new Promise((resolve) => {
      const safeCmd = cmd.trim();
      const dangerous = ["rm -rf /", "rm -rf /*", "format", "del /f"];
      if (dangerous.some(d => safeCmd.includes(d))) {
        resolve("BLOCKED: Dangerous command");
        return;
      }
      
      const proc = exec(safeCmd, { 
        cwd: cwd || process.cwd(),
        shell: true,
        timeout: 60000
      }, (err, stdout, stderr) => {
        if (err) resolve(`ERROR: ${err.message}\n${stderr}`);
        else resolve(stdout || stderr || "OK");
      });
    });
  },

  get_project_context: () => {
    try {
      const files = execSync(`find . -type f \\( -name "*.ts" -o -name "*.js" -o -name "*.json" \\) | grep -v node_modules | grep -v ".git" | head -30`, { encoding: "utf-8" });
      return files;
    } catch (e) {
      return "Could not get project files";
    }
  },

  git_status: () => {
    try {
      return execSync("git status --short 2>/dev/null || echo 'Not a git repo'", { encoding: "utf-8" });
    } catch (e) {
      return "Not a git repo";
    }
  },

  git_diff: () => {
    try {
      return execSync("git diff --stat 2>/dev/null || echo 'No changes'", { encoding: "utf-8" });
    } catch (e) {
      return "No changes";
    }
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
  { name: "git_diff", description: "Show git diff", params: {} }
];