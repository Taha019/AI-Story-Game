export class GeminiService {
  constructor(apiKey = process.env.GEMINI_API_KEY, groqKey = process.env.GROQ_API_KEY) {
    this.geminiKey = apiKey || process.env.GEMINI_API_KEY;
    this.groqKey = groqKey || process.env.GROQ_API_KEY;

    if (!this.geminiKey && !this.groqKey) {
      throw new Error('At least one API key (Gemini or Groq) is required to run the game.');
    }

    // List of Gemini models to attempt first
    this.geminiModels = [
      'gemini-2.5-flash',
      'gemini-1.5-flash'
    ];
  }

  async generatePrompt() {
    const promptText = `Generate 1 creative short story title, 1 literary genre, and 3 mandatory words/keywords. Respond strictly in valid JSON format with no Markdown formatting: {"title": "...", "genre": "...", "keywords": ["...", "...", "..."]}`;
    const response = await this.callAIWithFallback(promptText, true);
    if (!response || !response.title || !response.keywords) {
      throw new Error('Failed to parse title/prompt from AI response.');
    }
    return response;
  }

  async judgeStories(title, genre, keywords, submissions, customMetrics) {
    const formattedStories = submissions
      .map((s, idx) => `Player ${idx + 1} (${s.playerName}):\n"${s.story}"`)
      .join('\n\n');

    const metricsList = customMetrics
      .map((m, i) => `${i + 1}. ${m.name}: ${m.description} (1-10)`)
      .join('\n');

    const metricsJsonFields = customMetrics
      .map(m => `"${m.key}": 8`)
      .join(',\n          ');

    const systemInstruction = `You are an expert literary judge. Grade each short story based on these custom criteria (1-10 scale each):
${metricsList}

Also provide a 1-sentence story summary and a 1-sentence constructive critique for each player.

Respond strictly in valid JSON format matching this exact structure:
{
  "evaluations": [
    {
      "playerName": "...",
      "summary": "Concise summary of their story entry...",
      "critique": "Short constructive critique...",
      "scores": {
          ${metricsJsonFields}
      }
    }
  ]
}`;

    const promptText = `Story Title: ${title}\nGenre: ${genre}\nKeywords: ${keywords.join(', ')}\n\nSubmissions:\n${formattedStories}`;
    const response = await this.callAIWithFallback(promptText, true, systemInstruction);

    if (!response || !Array.isArray(response.evaluations)) {
      throw new Error('Failed to obtain evaluations from AI API.');
    }
    return response.evaluations;
  }

  /**
   * Orchestrates attempts across Gemini models and falls back to Groq
   */
  async callAIWithFallback(prompt, jsonMode = false, systemInstruction = '') {
    let errors = [];

    // 1. Try Gemini models if Gemini API key exists
    if (this.geminiKey) {
      for (const modelName of this.geminiModels) {
        try {
          return await this.callGemini(modelName, prompt, jsonMode, systemInstruction);
        } catch (err) {
          console.warn(`Gemini (${modelName}) failed: ${err.message}. Trying next fallback...`);
          errors.push(`Gemini [${modelName}]: ${err.message}`);
        }
      }
    }

    // 2. Fallback to Groq API if key is available
    if (this.groqKey) {
      try {
        console.log('Falling back to Groq API (llama-3.3-70b-versatile)...');
        return await this.callGroq('llama-3.3-70b-versatile', prompt, jsonMode, systemInstruction);
      } catch (err) {
        console.warn(`Groq API failed: ${err.message}`);
        errors.push(`Groq: ${err.message}`);
      }
    }

    throw new Error(`All AI providers failed.\nDetails:\n${errors.join('\n')}`);
  }

  /**
   * Calls Google Gemini API
   */
  async callGemini(modelName, prompt, jsonMode, systemInstruction) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(this.geminiKey)}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    
    if (systemInstruction) payload.system_instruction = { parts: [{ text: systemInstruction }] };
    if (jsonMode) payload.generationConfig = { response_mime_type: 'application/json' };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? JSON.parse(text) : null;
  }

  /**
   * Calls Groq API (OpenAI Compatible)
   */
  async callGroq(modelName, prompt, jsonMode, systemInstruction) {
    const messages = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const payload = {
      model: modelName,
      messages: messages,
      temperature: 0.7
    };

    if (jsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.groqKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    return text ? JSON.parse(text) : null;
  }
}