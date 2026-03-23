const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

const KEYS = {
  nvidia: process.env.NVIDIA_API_KEY,
  groq: process.env.GROQ_API_KEY,
  cfAccountId: process.env.CF_ACCOUNT_ID,
  cfToken: process.env.CF_TOKEN,
};

app.get('/health', (req, res) => res.json({ status: 'ok', keys: {
  nvidia: !!KEYS.nvidia, groq: !!KEYS.groq, cf: !!(KEYS.cfAccountId && KEYS.cfToken)
}}));

// ===== STREAMING CHAT =====
app.post('/api/chat', async (req, res) => {
  const { messages, model, provider, systemPrompt, temperature = 0.7, maxTokens = 4096 } = req.body;

  const sysMsg = { role: 'system', content: systemPrompt || 'You are AYOUB CODE, expert coding assistant.' };
  const allMessages = [sysMsg, ...messages];
  const body = { model, messages: allMessages, temperature, max_tokens: maxTokens, stream: true };

  // SSE headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    let apiRes;

    if (provider === 'nvidia') {
      if (!KEYS.nvidia) { res.write(`data: ${JSON.stringify({error:'NVIDIA key missing'})}\n\n`); return res.end(); }
      apiRes = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${KEYS.nvidia}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } else if (provider === 'groq') {
      if (!KEYS.groq) { res.write(`data: ${JSON.stringify({error:'Groq key missing'})}\n\n`); return res.end(); }
      apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${KEYS.groq}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } else if (provider === 'cf') {
      if (!KEYS.cfAccountId || !KEYS.cfToken) { res.write(`data: ${JSON.stringify({error:'CF keys missing'})}\n\n`); return res.end(); }
      const cfModel = model.startsWith('@') ? model : '@' + model;
      apiRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${KEYS.cfAccountId}/ai/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${KEYS.cfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, model: cfModel })
      });
    } else {
      res.write(`data: ${JSON.stringify({error:'مزود غير معروف'})}\n\n`); return res.end();
    }

    if (!apiRes.ok) {
      const err = await apiRes.json();
      res.write(`data: ${JSON.stringify({error: err.error?.message || 'API Error'})}\n\n`);
      return res.end();
    }

    // Stream the response
    const reader = apiRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content || '';
            if (token) res.write(`data: ${JSON.stringify({token})}\n\n`);
          } catch(e) {}
        }
      }
    }
    res.end();

  } catch (e) {
    res.write(`data: ${JSON.stringify({error: e.message})}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => console.log(`🚀 AYOUB CODE Streaming on port ${PORT}`));
