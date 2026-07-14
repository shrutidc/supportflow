/**
 * LLM Abstraction Layer for SupportFlow AI
 * 
 * Supports providers:
 *   - 'watsonx'  -> IBM Granite via watsonx.ai REST API
 *   - 'mock'     -> Simulated responses for demo/development
 * 
 * Swap providers by changing AI_PROVIDER in .env
 */

class LLMClient {
    constructor(config = {}) {
        this.provider = config.provider || process.env.AI_PROVIDER || 'mock';
        this.apiKey = config.apiKey || process.env.WATSONX_API_KEY;
        this.projectId = config.projectId || process.env.WATSONX_PROJECT_ID;
        this.baseUrl = config.baseUrl || process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com';
        this.model = config.model || process.env.WATSONX_MODEL || 'ibm/granite-3-8b-instruct';
        this._iamToken = null;
        this._iamTokenExpiry = 0;
    }

    /**
     * Generate text from the LLM
     */
    async generate(prompt, options = {}) {
        const {
            maxTokens = 1024,
            temperature = 0.2,
            systemPrompt = ''
        } = options;

        if (this.provider === 'mock') {
            return this._mockGenerate(prompt, options);
        }

        if (this.provider === 'watsonx') {
            return this._watsonxGenerate(prompt, { maxTokens, temperature, systemPrompt });
        }

        throw new Error(`Unknown LLM provider: ${this.provider}`);
    }

    /**
     * Generate structured JSON from the LLM
     */
    async generateJSON(prompt, options = {}) {
        const raw = await this.generate(prompt, options);

        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = raw;
        const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1].trim();
        } else {
            const objMatch = raw.match(/\{[\s\S]*\}/);
            if (objMatch) jsonStr = objMatch[0];
        }

        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error('Failed to parse LLM JSON response:', jsonStr.substring(0, 200));
            throw new Error('LLM returned invalid JSON');
        }
    }

    // --- IBM watsonx.ai Provider ---

    async _getIAMToken() {
        if (this._iamToken && Date.now() < this._iamTokenExpiry) {
            return this._iamToken;
        }

        const res = await fetch('https://iam.cloud.ibm.com/identity/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${this.apiKey}`
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`IAM token request failed: ${res.status} ${errText}`);
        }

        const data = await res.json();
        this._iamToken = data.access_token;
        this._iamTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
        return this._iamToken;
    }

    async _watsonxGenerate(prompt, { maxTokens, temperature, systemPrompt }) {
        const token = await this._getIAMToken();

        const body = {
            model_id: this.model,
            input: prompt,
            parameters: {
                max_new_tokens: maxTokens,
                temperature: temperature,
                decoding_method: temperature > 0 ? 'sample' : 'greedy',
                stop_sequences: ['\n\n\n'],
                repetition_penalty: 1.1
            },
            project_id: this.projectId
        };

        const url = `${this.baseUrl}/ml/v1/text/generation?version=2024-03-14`;

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`watsonx.ai generation failed: ${res.status} ${errText}`);
        }

        const data = await res.json();
        return data.results?.[0]?.generated_text || '';
    }

    // --- Mock Provider (Demo Mode) ---

    async _mockGenerate(prompt, options) {
        // Simulate latency
        await new Promise(r => setTimeout(r, 300 + Math.random() * 500));

        const promptLower = prompt.toLowerCase();

        // Detect agent type from prompt content and return realistic mock data
        if (promptLower.includes('triage') || promptLower.includes('assess')) {
            return JSON.stringify(this._mockTriage(promptLower));
        }
        if (promptLower.includes('sentiment') || promptLower.includes('churn')) {
            return JSON.stringify(this._mockSentiment(promptLower));
        }
        if (promptLower.includes('duplicate') || promptLower.includes('similar')) {
            return JSON.stringify(this._mockDuplicates(promptLower));
        }
        if (promptLower.includes('routing') || promptLower.includes('engineering team')) {
            return JSON.stringify(this._mockRouting(promptLower));
        }
        if (promptLower.includes('reply') || promptLower.includes('response') || promptLower.includes('resolution')) {
            return JSON.stringify(this._mockResolution(promptLower));
        }
        if (promptLower.includes('knowledge') || promptLower.includes('extract')) {
            return JSON.stringify(this._mockKnowledge(promptLower));
        }
        if (promptLower.includes('weekly') || promptLower.includes('operations')) {
            return JSON.stringify(this._mockWeekly());
        }
        if (promptLower.includes('summar')) {
            return JSON.stringify({ summary: 'Customer is experiencing issues that require immediate attention. The ticket involves a technical problem affecting their workflow.' });
        }

        return JSON.stringify({ result: 'Mock AI response', confidence: 0.85 });
    }

    _mockTriage(prompt) {
        const isUrgent = prompt.includes('500') || prompt.includes('locked') || prompt.includes('cannot access') || prompt.includes('failing');
        const isBilling = prompt.includes('billing') || prompt.includes('charged') || prompt.includes('invoice') || prompt.includes('pricing');
        const isBug = prompt.includes('bug') || prompt.includes('glitch') || prompt.includes('timeout') || prompt.includes('broken');
        const isIntegration = prompt.includes('api') || prompt.includes('integration') || prompt.includes('webhook') || prompt.includes('salesforce');
        const isFrustrated = prompt.includes('urgent') || prompt.includes('stopped working') || prompt.includes('immediately');

        let category = 'Account Access';
        if (isBilling) category = 'Billing';
        else if (isBug) category = 'Bug';
        else if (isIntegration) category = 'Integration';

        return {
            priority: isUrgent ? 'High' : (isBilling ? 'Medium' : 'Low'),
            category,
            sentiment: isFrustrated ? 'Frustrated' : 'Neutral',
            urgency: isUrgent ? 'Critical' : 'Medium',
            confidence: 0.87 + Math.random() * 0.1,
            reasoning: `Ticket classified as ${category} based on content analysis. ${isUrgent ? 'High urgency detected due to system-critical impact.' : 'Standard priority based on request type.'}`,
            slaRisk: isUrgent,
            shouldEscalate: isUrgent && isIntegration
        };
    }

    _mockSentiment(prompt) {
        const isFrustrated = prompt.includes('urgent') || prompt.includes('stopped') || prompt.includes('locked') || prompt.includes('twice');
        const isPositive = prompt.includes('thanks') || prompt.includes('perfect') || prompt.includes('great');

        return {
            sentiment: isFrustrated ? 'Frustrated' : (isPositive ? 'Positive' : 'Neutral'),
            score: isFrustrated ? -0.7 : (isPositive ? 0.8 : 0.1),
            churnRisk: isFrustrated ? 0.65 : 0.15,
            reasoning: isFrustrated
                ? 'Customer language indicates frustration. Multiple negative indicators detected. Elevated churn risk.'
                : 'Customer tone is measured and constructive. Low churn risk.'
        };
    }

    _mockDuplicates() {
        const pool = [
            { ticketId: 'SF-1002', similarity: 0.89, summary: 'API returning 500 errors — previously escalated to Engineering.' },
            { ticketId: 'SF-1016', similarity: 0.76, summary: 'Webhook integration failing — related to API infrastructure.' },
            { ticketId: 'SF-1006', similarity: 0.72, summary: 'Integration with Salesforce failing — authentication token issue.' }
        ];
        const count = 1 + Math.floor(Math.random() * 2);
        return {
            duplicates: pool.slice(0, count),
            confidence: 0.78 + Math.random() * 0.15
        };
    }

    _mockRouting(prompt) {
        let team = 'Backend';
        if (prompt.includes('billing') || prompt.includes('charged') || prompt.includes('invoice')) team = 'Billing';
        else if (prompt.includes('css') || prompt.includes('ui') || prompt.includes('mobile') || prompt.includes('safari')) team = 'Frontend';
        else if (prompt.includes('2fa') || prompt.includes('locked') || prompt.includes('login') || prompt.includes('access')) team = 'Authentication';
        else if (prompt.includes('api') || prompt.includes('webhook') || prompt.includes('integration') || prompt.includes('salesforce')) team = 'API';
        else if (prompt.includes('deploy') || prompt.includes('provision') || prompt.includes('sandbox')) team = 'Infrastructure';

        return {
            team,
            reasoning: `Based on the ticket content involving ${team.toLowerCase()}-related issues, this should be routed to the ${team} team for specialized handling.`,
            confidence: 0.82 + Math.random() * 0.12
        };
    }

    _mockResolution(prompt) {
        return {
            suggestedReply: "Thank you for reaching out. I understand how disruptive this issue must be for your workflow.\n\nI've reviewed your case and here's what I recommend:\n\n1. As an immediate workaround, please try clearing your browser cache and attempting the action again.\n2. If the issue persists, I've escalated this to our engineering team for a deeper investigation.\n3. We'll keep you updated on progress within the next 2 hours.\n\nPlease don't hesitate to reach out if you have any other questions.",
            troubleshootingChecklist: [
                'Clear browser cache and cookies',
                'Try in an incognito/private window',
                'Check if the issue occurs across different browsers',
                'Verify account permissions are correctly configured',
                'Review recent activity logs for anomalies'
            ],
            nextQuestions: [
                'When did you first notice this issue?',
                'Has anything changed in your configuration recently?',
                'Are other team members experiencing the same problem?'
            ],
            potentialRootCause: 'Based on the symptoms described, this likely relates to a session or authentication state issue. Similar patterns have been observed with recent API gateway updates.',
            confidence: 0.84
        };
    }

    _mockKnowledge(prompt) {
        return {
            title: 'Troubleshooting Common Access Issues',
            problem: 'Users may experience access problems including portal redirects, locked accounts, or failed authentication.',
            rootCause: 'Session token expiration or authentication service latency can cause access failures.',
            solution: 'Clear browser cache, verify credentials, and check service status. If persistent, reset the authentication token through admin panel.',
            keywords: ['access', 'login', 'authentication', 'session', 'portal']
        };
    }

    _mockWeekly() {
        return {
            summary: 'This week saw a 12% increase in integration-related tickets, primarily driven by the recent API gateway update. Resolution times remained stable at 22 hours average. Three customers showed elevated churn risk signals requiring immediate follow-up.',
            metrics: {
                totalTickets: 20,
                resolved: 6,
                escalated: 4,
                avgResolutionHours: 22,
                slaBreaches: 2,
                customerSatisfaction: 94
            },
            topIssues: [
                { category: 'Integration', count: 6, trend: 'up' },
                { category: 'Account Access', count: 5, trend: 'stable' },
                { category: 'Billing', count: 5, trend: 'down' },
                { category: 'Bug', count: 4, trend: 'stable' }
            ],
            escalationTrends: 'Escalations increased this week, primarily in the Integration category. 4 tickets were escalated to Engineering Queue, with API-related issues being the top driver.',
            knowledgeGaps: [
                'No documentation for Salesforce integration token refresh',
                'Missing guide for bulk data export workarounds',
                'Webhook configuration troubleshooting not covered'
            ],
            recommendations: [
                'Create knowledge base article for Salesforce integration troubleshooting',
                'Prioritize API gateway stability in next sprint',
                'Schedule proactive outreach to the 3 high-churn-risk customers',
                'Add automated webhook health monitoring'
            ],
            supportHealthScore: 78
        };
    }

    /**
     * Get provider info for auditing
     */
    getProviderInfo() {
        return {
            provider: this.provider,
            model: this.provider === 'mock' ? 'mock-granite' : this.model,
            baseUrl: this.baseUrl
        };
    }
}

// Singleton instance
let _instance = null;

function getLLMClient(config) {
    if (!_instance || config) {
        _instance = new LLMClient(config);
        console.log(`[AI] LLM Client initialized: provider=${_instance.provider}, model=${_instance.model}`);
    }
    return _instance;
}

module.exports = { LLMClient, getLLMClient };
