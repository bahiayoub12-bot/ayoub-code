# AYOUB CODE — Backend

## النشر على Render

1. ارفع هذا المجلد على GitHub
2. اذهب إلى [render.com](https://render.com)
3. New → Web Service → اربطه بـ GitHub
4. الإعدادات:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. انسخ رابط الـ API بعد النشر

## النشر على Railway

1. ارفع على GitHub
2. اذهب إلى [railway.app](https://railway.app)
3. New Project → Deploy from GitHub
4. انسخ رابط الـ API

## API Endpoints

| Endpoint | Method | الوصف |
|----------|--------|-------|
| `/api/chat` | POST | إرسال رسالة للبوت |
| `/api/files/:sid` | GET | قائمة ملفات الجلسة |
| `/api/files/:sid/content?file=path` | GET | محتوى ملف |
| `/api/download/:sid` | GET | تحميل ZIP |
| `/api/session/:sid` | DELETE | حذف الجلسة |
| `/health` | GET | فحص السيرفر |

## مثال استخدام API

```javascript
const response = await fetch('https://your-backend.render.com/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'أنشئ صفحة HTML' }],
    model: 'llama-3.3-70b-versatile',
    provider: 'groq',
    groqKey: 'gsk_xxx',
    sessionId: 'abc123',
    systemPrompt: 'You are AYOUB CODE...',
    temperature: 0.7,
    maxTokens: 4096
  })
});
const data = await response.json();
console.log(data.response);     // رد البوت
console.log(data.filesCreated); // الملفات التي أنشأها
console.log(data.allFiles);     // كل الملفات في الجلسة
```
