const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 7860;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

// ===== SESSIONS =====
const sessions = {};
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// ===== TOOLS =====
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file in the project. Creates directories if needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root e.g. src/app/page.tsx' },
          content: { type: 'string', description: 'Full file content to write' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read content of a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List all files in the project.',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Directory to list. Use . for root.' }
        },
        required: ['dir']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file from the project.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a bash command in the project directory.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run e.g. npm install' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'todo_write',
      description: 'Save todo list for the project.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                task: { type: 'string' },
                done: { type: 'boolean' }
              }
            }
          }
        },
        required: ['todos']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'todo_read',
      description: 'Read the todo list for the project.',
      parameters: { type: 'object', properties: {} }
    }
  }
];

// ===== TOOL EXECUTOR =====
function executeTool(name, args, sessionDir) {
  try {
    switch (name) {
      case 'write_file': {
        const full = path.join(sessionDir, args.path);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, args.content, 'utf8');
        return { success: true, message: `✅ كُتب: ${args.path}` };
      }
      case 'read_file': {
        const full = path.join(sessionDir, args.path);
        if (!fs.existsSync(full)) return { success: false, message: `❌ لا يوجد: ${args.path}` };
        return { success: true, content: fs.readFileSync(full, 'utf8') };
      }
      case 'list_files': {
        const full = path.join(sessionDir, args.dir || '.');
        if (!fs.existsSync(full)) return { success: false, message: '❌ المجلد غير موجود' };
        return { success: true, files: getAllFiles(full, sessionDir) };
      }
      case 'delete_file': {
        const full = path.join(sessionDir, args.path);
        if (fs.existsSync(full)) fs.unlinkSync(full);
        return { success: true, message: `🗑️ حُذف: ${args.path}` };
      }
      case 'run_command': {
        const blocked = ['rm -rf /', 'format', 'shutdown', 'reboot', 'mkfs'];
        if (blocked.some(b => args.command.includes(b))) return { success: false, message: '❌ أمر محظور' };
        try {
          const out = execSync(args.command, { cwd: sessionDir, timeout: 30000, encoding: 'utf8', maxBuffer: 1024 * 512 });
          return { success: true, output: out || '(no output)' };
        } catch (e) {
          return { success: false, output: e.stderr || e.message };
        }
      }
      case 'todo_write': {
        fs.writeFileSync(path.join(sessionDir, '.todos.json'), JSON.stringify(args.todos, null, 2));
        return { success: true, message: `✅ حُفظت ${args.todos.length} مهمة` };
      }
      case 'todo_read': {
        const tp = path.join(sessionDir, '.todos.json');
        if (!fs.existsSync(tp)) return { success: true, todos: [] };
        return { success: true, todos: JSON.parse(fs.readFileSync(tp, 'utf8')) };
      }
      default:
        return { success: false, message: `❌ أداة غير معروفة: ${name}` };
    }
  } catch (e) {
    return { success: false, message: `❌ ${e.message}` };
  }
}

function getAllFiles(dir, root) {
  const files = [];
  const skip = ['node_modules', '.git', '.next', 'dist', 'build'];
  function scan(d) {
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d).forEach(item => {
      if (skip.includes(item)) return;
      const full = path.join(d, item);
      const rel = path.relative(root, full);
      if (fs.statSync(full).isDirectory()) scan(full);
      else files.push(rel);
    });
  }
  scan(dir);
  return files;
}

// ===== API CALLERS =====
async function callAPI(provider, model, messages, tools, keys, temp, maxTok) {
  let res, data;
  const body = { model, messages, temperature: temp, max_tokens: maxTok };
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }

  // Use process.env first, fallback to keys from request
  const nvidiaKey = process.env.NVIDIA_API_KEY || keys.nvidiaKey;
  const groqKey = process.env.GROQ_API_KEY || keys.groqKey;
  const cfAccountId = process.env.CF_ACCOUNT_ID || keys.cfAccountId;
  const cfToken = process.env.CF_TOKEN || keys.cfToken;

  if (provider === 'nvidia') {
    if (!nvidiaKey) throw new Error('مفتاح NVIDIA غير موجود');
    res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${nvidiaKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } else if (provider === 'groq') {
    if (!groqKey) throw new Error('مفتاح Groq غير موجود');
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } else if (provider === 'cf') {
    if (!cfAccountId || !cfToken) throw new Error('بيانات Cloudflare غير موجودة');
    res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } else {
    throw new Error('مزود غير معروف');
  }

  data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || data.errors?.[0]?.message || 'API Error');
  return data;
}

// ===== MAIN CHAT ENDPOINT =====
app.post('/api/chat', async (req, res) => {
  const {
    messages, model, provider,
    nvidiaKey, groqKey, cfAccountId, cfToken,
    temperature = 0.7, maxTokens = 4096,
    sessionId, systemPrompt
  } = req.body;

  const sid = sessionId || uuidv4();
  const sessionDir = path.join(SESSIONS_DIR, sid);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
  sessions[sid] = { lastActive: Date.now(), dir: sessionDir };

  const keys = { nvidiaKey, groqKey, cfAccountId, cfToken };
  const sysMsg = { role: 'system', content: systemPrompt || 'You are AYOUB CODE, expert coding assistant.' };
  let currentMessages = [sysMsg, ...messages];

  let finalResponse = '';
  const toolsUsed = [];
  const filesCreated = [];
  let iterations = 0;

  try {
    while (iterations < 10) {
      iterations++;
      const apiData = await callAPI(provider, model, currentMessages, TOOLS, keys, temperature, maxTokens);
      const msg = apiData.choices[0].message;
      currentMessages.push(msg);

      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          const args = JSON.parse(tc.function.arguments);
          const result = executeTool(tc.function.name, args, sessionDir);
          toolsUsed.push({ tool: tc.function.name, args, result });
          if (tc.function.name === 'write_file' && result.success) filesCreated.push(args.path);
          currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }
        continue;
      }

      finalResponse = msg.content || '';
      break;
    }

    const allFiles = getAllFiles(sessionDir, sessionDir).filter(f => !f.startsWith('.'));
    res.json({ success: true, response: finalResponse, sessionId: sid, toolsUsed, filesCreated, allFiles });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ===== GET FILES LIST =====
app.get('/api/files/:sid', (req, res) => {
  const dir = path.join(SESSIONS_DIR, req.params.sid);
  if (!fs.existsSync(dir)) return res.json({ files: [] });
  res.json({ files: getAllFiles(dir, dir).filter(f => !f.startsWith('.')) });
});

// ===== GET FILE CONTENT =====
app.get('/api/files/:sid/content', (req, res) => {
  const dir = path.join(SESSIONS_DIR, req.params.sid);
  const full = path.join(dir, req.query.file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'لا يوجد' });
  res.json({ content: fs.readFileSync(full, 'utf8'), file: req.query.file });
});

// ===== DOWNLOAD ZIP =====
app.get('/api/download/:sid', (req, res) => {
  const dir = path.join(SESSIONS_DIR, req.params.sid);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'الجلسة غير موجودة' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="ayoub-code-project.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);

  const skip = ['node_modules', '.git', '.next', '.todos.json'];
  getAllFiles(dir, dir).forEach(f => {
    if (!skip.some(s => f.includes(s))) {
      archive.file(path.join(dir, f), { name: f });
    }
  });

  archive.finalize();
});

// ===== DELETE SESSION =====
app.delete('/api/session/:sid', (req, res) => {
  const dir = path.join(SESSIONS_DIR, req.params.sid);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  delete sessions[req.params.sid];
  res.json({ success: true });
});

// ===== HEALTH =====
app.get('/health', (req, res) => res.json({ status: 'ok', sessions: Object.keys(sessions).length }));

// ===== CLEANUP every hour =====
setInterval(() => {
  const oneDay = 24 * 60 * 60 * 1000;
  Object.entries(sessions).forEach(([sid, data]) => {
    if (Date.now() - data.lastActive > oneDay) {
      if (fs.existsSync(data.dir)) fs.rmSync(data.dir, { recursive: true, force: true });
      delete sessions[sid];
    }
  });
}, 3600000);

app.listen(PORT, () => console.log(`🚀 AYOUB CODE Backend on port ${PORT}`));
