export class GeminiService {
  constructor(apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) {
      throw new Error('Gemini API key is required to run the game.');
    }
    this.apiKey = apiKey;
    // Updated model to gemini-2.5-flash
    this.apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  }

  async generatePrompt() {
    const promptText = `Generate 1 creative short story title, 1 literary genre, and 3 mandatory words/keywords. Respond strictly in JSON: {"title": "...", "genre": "...", "keywords": ["...", "...", "..."]}`;
    const response = await this.callGemini(promptText, true);
    if (!response || !response.title || !response.keywords) {
      throw new Error('Failed to parse title/prompt from Gemini response.');
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

    const systemInstruction = `You are an expert literary judge. Grade each short story based on the following custom criteria (1-10 scale each):
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

    const response = await this.callGemini(formattedStories, true, systemInstruction);
    if (!response || !Array.isArray(response.evaluations)) {
      throw new Error('Failed to obtain evaluations from Gemini API.');
    }
    return response.evaluations;
  }

  async callGemini(prompt, jsonMode = false, systemInstruction = '') {
    const url = `${this.apiUrl}?key=${encodeURIComponent(this.apiKey)}`;
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
      throw new Error(`Gemini API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? JSON.parse(text) : null;
  }
}