const axios = require('axios');

/**
 * BERT-based Emotion Detection Service
 * Uses Hugging Face Inference API with a fine-tuned BERT model for emotion classification
 * 
 * Emotions detected: sadness, joy, love, anger, fear, surprise
 * Returns emotion labels with confidence scores
 */

// Updated to use the new HuggingFace router endpoint (as of 2025)
const HUGGINGFACE_API_URL = 'https://router.huggingface.co/hf-inference/models/bhadresh-savani/bert-base-uncased-emotion';

// Fallback model if primary is unavailable
const FALLBACK_MODEL_URL = 'https://router.huggingface.co/hf-inference/models/j-hartmann/emotion-english-distilroberta-base';

// Emotion mappings for mental health context
const EMOTION_MAPPINGS = {
  sadness: { category: 'negative', severity: 'moderate', color: '#6B7280' },
  joy: { category: 'positive', severity: 'none', color: '#10B981' },
  love: { category: 'positive', severity: 'none', color: '#EC4899' },
  anger: { category: 'negative', severity: 'high', color: '#EF4444' },
  fear: { category: 'negative', severity: 'high', color: '#8B5CF6' },
  surprise: { category: 'neutral', severity: 'low', color: '#F59E0B' },
  neutral: { category: 'neutral', severity: 'none', color: '#9CA3AF' },
  // Additional emotions from fallback model
  disgust: { category: 'negative', severity: 'moderate', color: '#84CC16' },
};

// Mental health response strategies based on detected emotion
const RESPONSE_STRATEGIES = {
  sadness: {
    approach: 'empathetic_validation',
    tone: 'warm and understanding',
    focus: 'acknowledge feelings, offer comfort, suggest gentle coping strategies'
  },
  joy: {
    approach: 'celebration',
    tone: 'enthusiastic and encouraging',
    focus: 'celebrate the positive moment, reinforce positive behaviors'
  },
  love: {
    approach: 'supportive',
    tone: 'warm and affirming',
    focus: 'encourage healthy connections, validate emotional bonds'
  },
  anger: {
    approach: 'calming_validation',
    tone: 'calm and non-judgmental',
    focus: 'validate frustration, suggest healthy expression, de-escalation techniques'
  },
  fear: {
    approach: 'reassurance',
    tone: 'gentle and reassuring',
    focus: 'provide safety, address concerns, grounding techniques'
  },
  surprise: {
    approach: 'curious_exploration',
    tone: 'interested and supportive',
    focus: 'explore the unexpected, help process new information'
  },
  neutral: {
    approach: 'balanced',
    tone: 'friendly and conversational',
    focus: 'maintain engagement, explore underlying needs'
  },
  disgust: {
    approach: 'understanding',
    tone: 'non-judgmental',
    focus: 'explore the source, validate reaction, reframe if appropriate'
  }
};

/**
 * Detect emotion from text using BERT model
 * @param {string} text - User's message text
 * @returns {Promise<Object>} Emotion detection result with confidence scores
 */
async function detectEmotion(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      success: false,
      error: 'Invalid text input',
      emotion: 'neutral',
      confidence: 0,
      allEmotions: []
    };
  }

  const apiKey = process.env.HUGGINGFACE_API_KEY;
  
  // If no API key, use rule-based fallback
  if (!apiKey) {
    console.log('No HuggingFace API key, using rule-based emotion detection');
    return ruleBasedEmotionDetection(text);
  }

  try {
    const response = await axios.post(
      HUGGINGFACE_API_URL,
      { inputs: text },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      }
    );

    const results = response.data;
    
    // Handle different response formats
    let emotions = [];
    if (Array.isArray(results) && Array.isArray(results[0])) {
      emotions = results[0];
    } else if (Array.isArray(results)) {
      emotions = results;
    }

    if (emotions.length === 0) {
      return ruleBasedEmotionDetection(text);
    }

    // Sort by score descending
    emotions.sort((a, b) => b.score - a.score);
    
    const primaryEmotion = emotions[0].label.toLowerCase();
    const confidence = emotions[0].score;
    
    const emotionMeta = EMOTION_MAPPINGS[primaryEmotion] || EMOTION_MAPPINGS.neutral;
    const strategy = RESPONSE_STRATEGIES[primaryEmotion] || RESPONSE_STRATEGIES.neutral;

    return {
      success: true,
      emotion: primaryEmotion,
      confidence: confidence,
      category: emotionMeta.category,
      severity: emotionMeta.severity,
      color: emotionMeta.color,
      responseStrategy: strategy,
      allEmotions: emotions.map(e => ({
        emotion: e.label.toLowerCase(),
        confidence: e.score,
        ...EMOTION_MAPPINGS[e.label.toLowerCase()] || EMOTION_MAPPINGS.neutral
      })),
      modelUsed: 'bert-base-uncased-emotion',
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('HuggingFace API error:', error.message);
    
    // Try fallback model
    try {
      return await detectEmotionFallback(text, apiKey);
    } catch (fallbackError) {
      console.error('Fallback model also failed:', fallbackError.message);
      return ruleBasedEmotionDetection(text);
    }
  }
}

/**
 * Fallback to alternative emotion model
 */
async function detectEmotionFallback(text, apiKey) {
  const response = await axios.post(
    FALLBACK_MODEL_URL,
    { inputs: text },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    }
  );

  const results = response.data;
  let emotions = Array.isArray(results[0]) ? results[0] : results;
  
  emotions.sort((a, b) => b.score - a.score);
  
  const primaryEmotion = emotions[0].label.toLowerCase();
  const confidence = emotions[0].score;
  
  const emotionMeta = EMOTION_MAPPINGS[primaryEmotion] || EMOTION_MAPPINGS.neutral;
  const strategy = RESPONSE_STRATEGIES[primaryEmotion] || RESPONSE_STRATEGIES.neutral;

  return {
    success: true,
    emotion: primaryEmotion,
    confidence: confidence,
    category: emotionMeta.category,
    severity: emotionMeta.severity,
    color: emotionMeta.color,
    responseStrategy: strategy,
    allEmotions: emotions.map(e => ({
      emotion: e.label.toLowerCase(),
      confidence: e.score,
      ...EMOTION_MAPPINGS[e.label.toLowerCase()] || EMOTION_MAPPINGS.neutral
    })),
    modelUsed: 'emotion-english-distilroberta-base',
    timestamp: new Date().toISOString()
  };
}

/**
 * Rule-based emotion detection fallback
 * Used when API is unavailable
 */
function ruleBasedEmotionDetection(text) {
  const lowerText = text.toLowerCase();
  
  const emotionKeywords = {
    sadness: ['sad', 'depressed', 'unhappy', 'miserable', 'heartbroken', 'lonely', 'grief', 'hopeless', 'crying', 'tears', 'down', 'blue', 'disappointed', 'hurt', 'pain'],
    joy: ['happy', 'joyful', 'excited', 'great', 'wonderful', 'amazing', 'fantastic', 'love', 'blessed', 'grateful', 'thrilled', 'delighted', 'cheerful', 'glad', 'pleased'],
    anger: ['angry', 'furious', 'mad', 'annoyed', 'frustrated', 'irritated', 'hate', 'rage', 'upset', 'pissed', 'outraged', 'livid', 'hostile'],
    fear: ['scared', 'afraid', 'terrified', 'anxious', 'worried', 'nervous', 'panicked', 'frightened', 'fearful', 'dread', 'uneasy', 'stressed', 'overwhelmed'],
    surprise: ['surprised', 'shocked', 'amazed', 'astonished', 'unexpected', 'wow', 'unbelievable', 'incredible', 'stunned'],
    love: ['love', 'adore', 'cherish', 'care', 'affection', 'devoted', 'passionate', 'romantic', 'attached']
  };

  let detectedEmotions = [];

  for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
    let score = 0;
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        score += 0.15;
      }
    }
    if (score > 0) {
      detectedEmotions.push({
        emotion,
        confidence: Math.min(score, 0.95),
        ...EMOTION_MAPPINGS[emotion]
      });
    }
  }

  if (detectedEmotions.length === 0) {
    detectedEmotions.push({
      emotion: 'neutral',
      confidence: 0.6,
      ...EMOTION_MAPPINGS.neutral
    });
  }

  detectedEmotions.sort((a, b) => b.confidence - a.confidence);

  const primary = detectedEmotions[0];
  const strategy = RESPONSE_STRATEGIES[primary.emotion] || RESPONSE_STRATEGIES.neutral;

  return {
    success: true,
    emotion: primary.emotion,
    confidence: primary.confidence,
    category: primary.category,
    severity: primary.severity,
    color: primary.color,
    responseStrategy: strategy,
    allEmotions: detectedEmotions,
    modelUsed: 'rule-based-fallback',
    timestamp: new Date().toISOString()
  };
}

/**
 * Build emotion-aware prompt for Gemini
 * Enhanced with Rebirth's emotionally intelligent mental health support framework
 * @param {Object} emotionData - Detected emotion data
 * @param {string} userMessage - Original user message
 * @param {string} userContext - User profile context
 * @param {Object} additionalContext - Additional context (ideal self, anti-vision, chat history, emotion history)
 * @returns {string} Enhanced prompt with emotional context
 */
function buildEmotionAwarePrompt(emotionData, userMessage, userContext = '', additionalContext = {}) {
  const strategy = emotionData.responseStrategy || RESPONSE_STRATEGIES.neutral;
  
  // Extract additional context
  const idealSelf = additionalContext.idealSelf || '';
  const antiVision = additionalContext.antiVision || '';
  const emotionHistorySummary = additionalContext.emotionHistorySummary || '';
  const chatHistory = additionalContext.chatHistory || '';
  
  // Build emotion summary for prompt
  const secondaryEmotions = emotionData.allEmotions.slice(1, 4)
    .map(e => `- ${e.emotion}: ${(e.confidence * 100).toFixed(1)}%`)
    .join('\n');

  const emotionContext = `
You are Rebirth, an emotionally intelligent mental health support assistant.
Your role is to provide safe, empathetic, and non-judgmental conversational support.

═══════════════════════════════════════════════════════════════════
                     EMOTIONAL CONTEXT ANALYSIS
═══════════════════════════════════════════════════════════════════

🎭 Primary Emotion Detected: ${emotionData.emotion.toUpperCase()} 
   Confidence: ${(emotionData.confidence * 100).toFixed(1)}%
   Category: ${emotionData.category}
   Severity: ${emotionData.severity}

📊 Secondary Emotions:
${secondaryEmotions || '   None detected'}

═══════════════════════════════════════════════════════════════════
                          USER CONTEXT
═══════════════════════════════════════════════════════════════════

${userContext}

${idealSelf ? `🌟 User's Ideal Self (Goals & Aspirations):
${idealSelf}
` : ''}
${antiVision ? `⚠️ User's Anti-Vision (Patterns to Avoid):
${antiVision}
` : ''}
${emotionHistorySummary ? `📈 Recent Emotional Trend:
${emotionHistorySummary}
` : ''}
${chatHistory ? `💬 Recent Conversation Context:
${chatHistory}
` : ''}

═══════════════════════════════════════════════════════════════════
                     RESPONSE STRATEGY
═══════════════════════════════════════════════════════════════════

📋 Approach: ${strategy.approach}
🎯 Tone: ${strategy.tone}
💡 Focus: ${strategy.focus}

═══════════════════════════════════════════════════════════════════
                    RESPONSE INSTRUCTIONS
═══════════════════════════════════════════════════════════════════

1. ACKNOWLEDGE & VALIDATE: Start by acknowledging the user's emotional state in a calm, empathetic manner.

2. ADAPT YOUR RESPONSE based on emotional sensitivity:
   ${emotionData.emotion === 'sadness' || emotionData.emotion === 'fear' ? 
     '→ DETECTED DISTRESS: Respond gently, slow-paced, and supportive. Prioritize emotional safety.' :
     emotionData.emotion === 'anger' ? 
     '→ DETECTED FRUSTRATION: Focus on grounding and emotional regulation. Stay calm and non-judgmental.' :
     emotionData.emotion === 'joy' || emotionData.emotion === 'love' ?
     '→ DETECTED POSITIVITY: Reinforce healthy behavior. Celebrate progress aligned with their Ideal Self.' :
     '→ NEUTRAL STATE: Maintain warm engagement while exploring underlying needs.'}

3. ALIGN guidance subtly with the user's Ideal Self without forcing motivation.

4. AVOID:
   - Clinical diagnosis or medical advice
   - Authoritative or prescriptive statements
   - Minimizing or dismissing feelings
   - Generic platitudes

5. CRISIS PROTOCOL: If the message suggests extreme distress or self-harm:
   ⚠️ Do NOT continue normal conversation
   ⚠️ Encourage seeking professional or emergency help in a supportive tone
   ⚠️ Provide crisis resources if appropriate

6. RESPONSE STYLE:
   - Keep it conversational, human-like, and reflective
   - Be concise but meaningful (2-4 sentences typically)
   - End with ONE gentle question that invites reflection, not pressure

═══════════════════════════════════════════════════════════════════
                        USER MESSAGE
═══════════════════════════════════════════════════════════════════

"${userMessage}"

═══════════════════════════════════════════════════════════════════

Generate a supportive, emotionally aligned response that feels human, safe, and context-aware:`;

  return emotionContext;
}

module.exports = {
  detectEmotion,
  buildEmotionAwarePrompt,
  EMOTION_MAPPINGS,
  RESPONSE_STRATEGIES
};
