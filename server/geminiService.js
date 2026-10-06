export class GeminiService {
  constructor(apiKey = process.env.GROQ_API_KEY) {
    this.apiKey = apiKey || process.env.GROQ_API_KEY;

    this.apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
    this.model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  }

  async generatePrompt() {
    const promptText = `Generate 1 creative short story title, 1 literary genre, and 3 mandatory words/keywords. Respond strictly in valid JSON format with no extra markdown formatting: {"title": "...", "genre": "...", "keywords": ["...", "...", "..."]}`;
    const response = await this.callAI(promptText, true);
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
      .map((m, i) => `${i + 1}. ${m.name}: ${m.description} (Grade strictly between 1 and 10)`)
      .join('\n');

    const metricsJsonFields = customMetrics
      .map(m => `"${m.key}": 8`)
      .join(',\n          ');

    const systemInstruction = `You are an expert literary judge evaluating stories written simultaneously by multiple players.
Grade EVERY submission on the following criteria. IMPORTANT: Each criterion MUST be an integer score out of 10 (1 = poor, 10 = exceptional):

${metricsList}

Also compute "totalScore" as the exact sum of all individual metric scores (e.g. if 3 criteria are graded 8, 7, 9, totalScore is 24).
Include a 1-sentence story summary and a 1-sentence constructive critique for each player.

Respond strictly in valid JSON format matching this exact structure:
{
  "evaluations": [
    {
      "playerName": "...",
      "summary": "Concise summary of their story entry...",
      "critique": "Short constructive critique...",
      "scores": {
          ${metricsJsonFields}
      },
      "totalScore": 24
    }
  ]
}`;

    const promptText = `Story Title: ${title}\nGenre: ${genre}\nKeywords: ${keywords.join(', ')}\n\nSubmissions:\n${formattedStories}`;
    const response = await this.callAI(promptText, true, systemInstruction);

    if (!response || !Array.isArray(response.evaluations)) {
      throw new Error('Failed to obtain evaluations from AI API.');
    }
    return response.evaluations;
  }

  async callAI(prompt, jsonMode = false, systemInstruction = '') {
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY environment variable is required to use AI features.');
    }

    const messages = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const payload = {
      model: this.model,
      messages: messages,
      temperature: 0.7
    };

    if (jsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    return text ? JSON.parse(text) : null;
  }
}