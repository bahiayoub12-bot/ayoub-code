const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// المفاتيح من Railway Variables
const KEYS = {
  nvidia: process.env.NVIDIA_API_KEY,
  groq: process.env.GROQ_API_KEY,
  cfAccountId: process.env.CF_ACCOUNT_ID,
  cfToken: process.env.CF_TOKEN,
};

app.get('/health', (req, res) => res.json({ status: 'ok', keys: {
  nvidia: !!KEYS.nvidia,
  groq: !!KEYS.groq,
  cf: !!(KEYS.cfAccountId && KEYS.cfToken)
}}));

app.post('/api/chat', async (req, res) => {
  const { messages, model, provider, systemPrompt, temperature = 0.7, maxTokens = 4096 } = req.body;

  const sysMsg = { role: 'system', content: systemPrompt || 'You are AYOUB CODE, expert coding assistant.' };
  const allMessages = [sysMsg, ...messages];
  const body = { model, messages: allMessages, temperature, max_tokens: maxTokens };

  try {
    let response, data;

    if (provider === 'nvidia') {
      if (!KEYS.nvidia) return res.status(400).json({ success: false, error: 'NVIDIA key missing in Railway Variables' });
      response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${KEYS.nvidia}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

    } else if (provider === 'groq') {
      if (!KEYS.groq) return res.status(400).json({ success: false, error: 'Groq key missing in Railway Variables' });
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${KEYS.groq}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

    } else if (provider === 'cf') {
      if (!KEYS.cfAccountId || !KEYS.cfToken) return res.status(400).json({ success: false, error: 'Cloudflare keys missing in Railway Variables' });
      const cfModel = model.startsWith('@') ? model : '@' + model;
      response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${KEYS.cfAccountId}/ai/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${KEYS.cfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, model: cfModel })
      });

    } else {
      return res.status(400).json({ success: false, error: 'مزود غير معروف' });
    }

    data = await response.json();
    if (!response.ok) return res.status(response.status).json({ success: false, error: data.error?.message || data.errors?.[0]?.message || 'API Error' });

    const text = data.choices?.[0]?.message?.content || data.result?.response || '';
    res.json({ success: true, response: text });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`🚀 AYOUB CODE running on port ${PORT}`));
