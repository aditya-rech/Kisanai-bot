const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const app = express();
app.use(express.json());

// ── Webhook verification (Meta calls this once to confirm your server is real)
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── Main webhook — runs every time a farmer sends a photo
app.post('/webhook', async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'image') {
      res.sendStatus(200);
      return;
    }

    const phone   = message.from;
    const imageId = message.image.id;

    // Step 1: Get the image download URL from Meta
    const urlRes  = await fetch(
      `https://graph.facebook.com/v18.0/${imageId}`,
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    );
    const urlData = await urlRes.json();
    const imageUrl = urlData.url;

    // Step 2: Download the actual image bytes
    const imgRes    = await fetch(imageUrl, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
    });
    const imgBuffer = await imgRes.arrayBuffer();
    const base64    = Buffer.from(imgBuffer).toString('base64');

    // Step 3: Send image to Claude and get Hindi diagnosis
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            {
              type:   'image',
              source: {
                type:       'base64',
                media_type: 'image/jpeg',
                data:       base64
              }
            },
            {
              type: 'text',
              text: `आप एक अनुभवी कृषि विशेषज्ञ हैं। इस फसल की फोटो देखकर बताएं:

1. बीमारी का नाम (Disease name)
2. गंभीरता: हल्की / मध्यम / गंभीर
3. कारण (Cause)
4. जैविक उपचार (Organic treatment)
5. रासायनिक उपचार (Chemical treatment)
6. बचाव के उपाय (Prevention)

सब कुछ सरल हिंदी में लिखें जो एक किसान आसानी से समझ सके।`
            }
          ]
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const diagnosis  = claudeData.content?.[0]?.text || 'माफ करें, फोटो से बीमारी पहचान नहीं हो सकी। कृपया साफ फोटो भेजें।';

    // Step 4: Send the diagnosis back to farmer on WhatsApp
    await fetch(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to:                phone,
          type:              'text',
          text: {
            body: `🌱 *KisanAI फसल रोग निदान*\n\n${diagnosis}\n\n---\n_KisanAI - आपका डिजिटल कृषि सलाहकार_`
          }
        })
      }
    );

    res.sendStatus(200);

  } catch (err) {
    console.error('Error:', err);
    res.sendStatus(200); // Always return 200 to Meta or it will retry endlessly
  }
});

// ── Health check — visit your Railway URL to confirm server is running
app.get('/', (req, res) => {
  res.send('KisanAI bot is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`KisanAI running on port ${PORT}`));