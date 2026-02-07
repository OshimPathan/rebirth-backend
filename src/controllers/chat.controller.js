const User = require('../models/user.model');
const ChatSession = require('../models/chatSession.model');
// const ChatMessage = require('../models/chatMessage.model');
const ChatMessageBucket = require('../models/chatMessageBucket.model');
const axios = require('axios');
const { detectEmotion } = require('../services/emotion.service');
const { executeDecisionPipeline, buildControlledPrompt } = require('../services/decision.service');

// Helper to build user context string similar to mobile app
function buildUserContext(userDoc) {
  if (!userDoc) return '';

  const lines = [];
  lines.push('User Context:');

  if (userDoc.name) lines.push(`- Name: ${userDoc.name}`);
  if (userDoc.email) lines.push(`- Email: ${userDoc.email}`);

  const onboarding = userDoc.onboarding || {};
  const personalInfo = onboarding.personalInfo || {};
  const transformation = onboarding.transformation || {};

  if (personalInfo.age) lines.push(`- Age: ${personalInfo.age}`);
  if (personalInfo.gender) lines.push(`- Gender: ${personalInfo.gender}`);
  if (personalInfo.occupation) lines.push(`- Occupation: ${personalInfo.occupation}`);
  if (personalInfo.location) lines.push(`- Location: ${personalInfo.location}`);

  if (transformation.idealSelfDescription) {
    lines.push(`- Ideal Self: ${transformation.idealSelfDescription}`);
  }
  if (Array.isArray(transformation.qualitiesToBuild) && transformation.qualitiesToBuild.length) {
    lines.push(`- Qualities to Build: ${transformation.qualitiesToBuild.join(', ')}`);
  }
  if (Array.isArray(transformation.negativeHabits) && transformation.negativeHabits.length) {
    lines.push(`- Negative Habits to Avoid: ${transformation.negativeHabits.join(', ')}`);
  }
  if (Array.isArray(userDoc.goals) && userDoc.goals.length) {
    lines.push(`- Current Goals:`);
    for (const goal of userDoc.goals) {
      if (goal.title) lines.push(`  • ${goal.title} (${goal.category || 'general'})`);
    }
  }

  lines.push('');
  lines.push('Please provide personalized responses based on this user context and make it short and concise.');
  lines.push('');

  return lines.join('\n');
}

// Convert **bold** segments to spans for client-side rendering
function formatTextToSpans(text) {
  if (typeof text !== 'string' || !text.length) {
    return [{ text: '', bold: false }];
  }

  const regex = /\*\*(.*?)\*\*/g;
  const spans = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const [fullMatch, inner] = match;
    const start = match.index;

    if (start > lastIndex) {
      spans.push({ text: text.slice(lastIndex, start), bold: false });
    }

    spans.push({ text: inner, bold: true });
    lastIndex = start + fullMatch.length;
  }

  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex), bold: false });
  }

  if (spans.length === 0) {
    return [{ text, bold: false }];
  }

  return spans;
}

function getTodayRangeUTC() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
}

exports.getOrCreateTodaySession = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { start, end } = getTodayRangeUTC();

    let session = await ChatSession.findOne({
      user: userId,
      createdAt: { $gte: start, $lte: end },
      archived: false,
    });

    if (!session) {
      session = await ChatSession.create({ user: userId, title: 'New Chat' });
    }

    // Optionally return latest messages for immediate render
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);

    const bucketCursor = ChatMessageBucket.find({ session: session._id, user: userId })
      .sort({ bucketIndex: -1 })
      .cursor();

    const collected = [];
    for await (const bucket of bucketCursor) {
      if (!Array.isArray(bucket.messages) || bucket.messages.length === 0) continue;
      for (let i = bucket.messages.length - 1; i >= 0; i--) {
        const m = bucket.messages[i];
        collected.push({ role: m.role, text: m.text, spans: m.spans, createdAt: m.createdAt });
        if (collected.length >= limit) break;
      }
      if (collected.length >= limit) break;
    }

    collected.reverse();
    return res.json({ session, messages: collected });
  } catch (error) {
    console.error('Get today session error:', error);
    return res.status(500).json({ message: 'Failed to get today\'s session' });
  }
};

async function collectRecentMessagesForContext(sessionId, userId, maxCount) {
  const collected = [];
  const bucketCursor = ChatMessageBucket.find({ session: sessionId, user: userId })
    .sort({ bucketIndex: -1 })
    .cursor();
  for await (const bucket of bucketCursor) {
    if (!Array.isArray(bucket.messages) || bucket.messages.length === 0) continue;
    for (let i = bucket.messages.length - 1; i >= 0; i--) {
      const m = bucket.messages[i];
      collected.push({ role: m.role, text: m.text });
      if (collected.length >= maxCount) break;
    }
    if (collected.length >= maxCount) break;
  }
  collected.reverse();
  return collected;
}

exports.createSession = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { title } = req.body || {};
    // Default title to current date if not provided
    const defaultTitle = title || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const session = await ChatSession.create({ user: userId, title: defaultTitle });
    return res.status(201).json({ session });
  } catch (error) {
    console.error('Create session error:', error);
    return res.status(500).json({ message: 'Failed to create session' });
  }
};

exports.listSessions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const sessions = await ChatSession.find({ user: userId, archived: false })
      .sort({ updatedAt: -1 })
      .lean();
    return res.json({ sessions });
  } catch (error) {
    console.error('List sessions error:', error);
    return res.status(500).json({ message: 'Failed to list sessions' });
  }
};

exports.getSessionMessages = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { sessionId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const beforeTs = req.query.before ? new Date(req.query.before) : null;

    // Read buckets from newest to oldest until we collect 'limit' messages
    const bucketCursor = ChatMessageBucket.find({ session: sessionId, user: userId })
      .sort({ bucketIndex: -1 })
      .cursor();

    const collected = [];
    for await (const bucket of bucketCursor) {
      if (!Array.isArray(bucket.messages) || bucket.messages.length === 0) continue;
      // iterate messages from newest to oldest
      for (let i = bucket.messages.length - 1; i >= 0; i--) {
        const m = bucket.messages[i];
        if (beforeTs && new Date(m.createdAt) >= beforeTs) {
          continue;
        }
        collected.push({ 
          role: m.role, 
          text: m.text, 
          spans: m.spans, 
          emotionData: m.emotionData || null,
          createdAt: m.createdAt 
        });
        if (collected.length >= limit) break;
      }
      if (collected.length >= limit) break;
    }

    // chronological order
    collected.reverse();

    return res.json({ messages: collected, limit, nextCursor: collected.length ? collected[0].createdAt : null });
  } catch (error) {
    console.error('Get session messages error:', error);
    return res.status(500).json({ message: 'Failed to load messages' });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const { message, sessionId, title } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ message: 'message is required' });
    }
    const userId = req.user?.userId;
    let session = null;
    if (sessionId) {
      session = await ChatSession.findOne({ _id: sessionId, user: userId });
    }
    if (!session) {
      // Enforce daily session by default
      const { start, end } = getTodayRangeUTC();
      session = await ChatSession.findOne({ user: userId, createdAt: { $gte: start, $lte: end }, archived: false });
      if (!session) {
        const defaultTitle = title || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        session = await ChatSession.create({ user: userId, title: defaultTitle });
      }
    }

    const userDoc = await User.findById(userId).lean();
    const userContext = buildUserContext(userDoc);

    // Fetch recent across buckets up to N messages
    const recent = await collectRecentMessagesForContext(session._id, userId, 20);

    let conversationContext = '';
    if (recent.length) {
      conversationContext += '\nPrevious conversation:\n';
      for (const h of recent.reverse()) {
        const sender = h.role === 'user' ? 'User' : 'Rebirth';
        conversationContext += `${sender}: ${h.text}\n`;
      }
      conversationContext += '\n';
    }

    // ═══════════════════════════════════════════════════════════════════
    // LAYER 1: EMOTION UNDERSTANDING (BERT-based detection)
    // ═══════════════════════════════════════════════════════════════════
    const emotionData = await detectEmotion(message);
    console.log('🎭 Detected emotion:', emotionData.emotion, 'with confidence:', emotionData.confidence);

    // ═══════════════════════════════════════════════════════════════════
    // LAYER 2: CONTEXT EXTRACTION (Onboarding + History)
    // ═══════════════════════════════════════════════════════════════════
    const onboarding = userDoc?.onboarding || {};
    const transformation = onboarding.transformation || {};
    
    // Build Ideal Self context
    let idealSelf = '';
    if (transformation.idealSelfDescription) {
      idealSelf += transformation.idealSelfDescription;
    }
    if (Array.isArray(transformation.qualitiesToBuild) && transformation.qualitiesToBuild.length) {
      idealSelf += ` | Qualities: ${transformation.qualitiesToBuild.join(', ')}`;
    }
    if (Array.isArray(userDoc?.goals)) {
      const activeGoals = userDoc.goals.filter(g => g.status === 'active');
      if (activeGoals.length) {
        idealSelf += ` | Goals: ${activeGoals.map(g => g.title).join(', ')}`;
      }
    }
    
    // Build Anti-Vision context (patterns to avoid)
    let antiVision = '';
    if (Array.isArray(transformation.negativeHabits) && transformation.negativeHabits.length) {
      antiVision = transformation.negativeHabits.join(', ');
    }
    
    // Extract emotion history from recent messages
    const emotionHistory = recent
      .filter(m => m.emotionData?.emotion)
      .map(m => m.emotionData.emotion);

    // ═══════════════════════════════════════════════════════════════════
    // MULTI-STAGE DECISION PIPELINE (All intelligence lives HERE)
    // STEP 1: Emotional Interpretation
    // STEP 2: Temporal Reasoning  
    // STEP 3: Identity Alignment Check
    // STEP 4: Memory Gating (Anti-Hallucination)
    // STEP 5: Strategy Selection
    // STEP 6: Ethical Constraints
    // ═══════════════════════════════════════════════════════════════════
    const pipeline = executeDecisionPipeline(message, emotionData, {
      idealSelf,
      antiVision,
      emotionHistory,
      userName: userDoc?.name || '',
      verifiedMemories: [] // TODO: Add verified memory storage
    });
    
    console.log('🧠 Strategy selected:', pipeline.decision.strategy);
    console.log('   Reason:', pipeline.decision.reason);
    console.log('   Tone:', pipeline.decision.tone);
    
    // Log crisis detection if triggered
    if (pipeline.crisis.isCrisis) {
      console.log('🚨 CRISIS DETECTED - Activating safety escalation');
    }

    // ═══════════════════════════════════════════════════════════════════
    // CONTROLLED PROMPT BUILDING (Gemini is ONLY a language generator)
    // ═══════════════════════════════════════════════════════════════════
    const controlledPrompt = buildControlledPrompt(message, pipeline, {
      idealSelf,
      antiVision,
      userName: userDoc?.name || ''
    });

    // ═══════════════════════════════════════════════════════════════════
    // LANGUAGE GENERATION (Gemini follows our pre-computed decisions)
    // ═══════════════════════════════════════════════════════════════════
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ message: 'Missing GEMINI_API_KEY in server environment' });
    }

    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

    const body = {
      contents: [
        {
          parts: [{ text: controlledPrompt }]
        }
      ]
    };

    const url = `${endpoint}?key=${apiKey}`;
    let responseData;
    try {
      const aiResponse = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' }
      });
      responseData = aiResponse.data;
    } catch (err) {
      const status = err.response?.status || 500;
      const details = err.response?.data || err.message;
      return res.status(502).json({ message: 'AI provider error', status, details });
    }
    let rawText = 'Sorry, I could not generate a response.';
    try {
      rawText = responseData?.candidates?.[0]?.content?.parts?.[0]?.text || rawText;
    } catch (_) {}

    const spans = formatTextToSpans(rawText);

    // ═══════════════════════════════════════════════════════════════════
    // PERSIST WITH PIPELINE DATA (For analytics & learning)
    // ═══════════════════════════════════════════════════════════════════
    const MAX_BUCKET_SIZE = 500; // number of messages per bucket
    let bucket = await ChatMessageBucket.findOne({ session: session._id })
      .sort({ bucketIndex: -1 });
    if (!bucket || bucket.count >= MAX_BUCKET_SIZE) {
      const nextIndex = bucket ? bucket.bucketIndex + 1 : 0;
      bucket = await ChatMessageBucket.create({
        session: session._id,
        user: userId,
        bucketIndex: nextIndex,
        messages: [],
        count: 0,
      });
    }

    // Store emotion data AND full pipeline data for analytics
    bucket.messages.push({ 
      role: 'user', 
      text: message, 
      emotionData: emotionData,
      pipelineData: {
        strategy: pipeline.decision.strategy,
        reason: pipeline.decision.reason,
        tone: pipeline.decision.tone,
        isCrisis: pipeline.crisis.isCrisis,
        emotionInterpretation: pipeline.stages.emotionInterpretation,
        temporalTrend: pipeline.stages.temporalReasoning.trend,
        identityAlignment: {
          supportsIdealSelf: pipeline.stages.identityAlignment.supportsIdealSelf,
          triggersAntiVision: pipeline.stages.identityAlignment.triggersAntiVision
        }
      },
      createdAt: new Date() 
    });
    bucket.messages.push({ role: 'assistant', text: rawText, spans, createdAt: new Date() });
    bucket.count = bucket.messages.length;
    await bucket.save();

    // Update session counters
    await ChatSession.updateOne(
      { _id: session._id },
      {
        $inc: { messagesCount: 2 },
        $set: {
          lastMessageAt: new Date(),
          // Preserve existing title; only set a title if missing
          title: session.title && session.title.trim().length > 0
            ? session.title
            : (message ? message.slice(0, 30) : new Date().toISOString().slice(0, 10)),
        },
      }
    );

    // ═══════════════════════════════════════════════════════════════════
    // FINAL RESPONSE (Controlled, empathetic output)
    // ═══════════════════════════════════════════════════════════════════
    return res.json({ 
      text: rawText, 
      spans, 
      sessionId: session._id,
      emotionData: {
        emotion: emotionData.emotion,
        confidence: emotionData.confidence,
        category: emotionData.category,
        severity: emotionData.severity,
        color: emotionData.color,
        allEmotions: emotionData.allEmotions
      },
      pipeline: {
        strategy: pipeline.decision.strategy,
        tone: pipeline.decision.tone,
        temporalTrend: pipeline.stages.temporalReasoning.trend
      }
    });
  } catch (error) {
    console.error('Chat sendMessage error:', error);
    return res.status(500).json({ message: 'Something went wrong', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

// Update session metadata (e.g., title)
exports.updateSession = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { sessionId } = req.params;
    const { title } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ message: 'title is required' });
    }

    const session = await ChatSession.findOneAndUpdate(
      { _id: sessionId, user: userId },
      { $set: { title: title.trim() } },
      { new: true }
    ).lean();

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    return res.json({ session });
  } catch (error) {
    console.error('Update session error:', error);
    return res.status(500).json({ message: 'Failed to update session' });
  }
};

// Get emotion analytics for a user
exports.getEmotionAnalytics = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { days = 30 } = req.query;
    const daysNum = Math.min(parseInt(days, 10) || 30, 90);
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    startDate.setHours(0, 0, 0, 0);

    // Get all user's chat sessions within the date range
    const sessions = await ChatSession.find({
      user: userId,
      createdAt: { $gte: startDate }
    }).select('_id').lean();

    const sessionIds = sessions.map(s => s._id);

    // Get all message buckets for these sessions
    const buckets = await ChatMessageBucket.find({
      session: { $in: sessionIds },
      user: userId
    }).lean();

    // Collect all messages with emotion data
    const emotionRecords = [];
    const emotionCounts = {};
    const dailyEmotions = {};
    let totalConfidence = 0;
    let emotionCount = 0;
    let highSeverityCount = 0;
    let moderateSeverityCount = 0;
    const consecutiveNegative = [];
    let currentNegativeStreak = 0;

    for (const bucket of buckets) {
      if (!Array.isArray(bucket.messages)) continue;
      
      for (const msg of bucket.messages) {
        if (msg.role === 'user' && msg.emotionData) {
          const emotion = msg.emotionData.emotion;
          const confidence = msg.emotionData.confidence || 0;
          const category = msg.emotionData.category;
          const severity = msg.emotionData.severity;
          const date = new Date(msg.createdAt).toISOString().split('T')[0];

          emotionRecords.push({
            emotion,
            confidence,
            category,
            severity,
            color: msg.emotionData.color,
            timestamp: msg.createdAt
          });

          // Count emotions
          emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;

          // Track severity for mental health assessment
          if (severity === 'high') highSeverityCount++;
          if (severity === 'moderate') moderateSeverityCount++;

          // Track consecutive negative emotions
          if (category === 'negative') {
            currentNegativeStreak++;
          } else {
            if (currentNegativeStreak > 0) {
              consecutiveNegative.push(currentNegativeStreak);
            }
            currentNegativeStreak = 0;
          }

          // Daily emotion tracking
          if (!dailyEmotions[date]) {
            dailyEmotions[date] = { 
              emotions: {}, 
              totalConfidence: 0, 
              count: 0,
              positiveConfidence: 0,
              negativeConfidence: 0,
              positiveCount: 0,
              negativeCount: 0
            };
          }
          dailyEmotions[date].emotions[emotion] = (dailyEmotions[date].emotions[emotion] || 0) + 1;
          dailyEmotions[date].totalConfidence += confidence;
          dailyEmotions[date].count += 1;
          
          if (category === 'positive') {
            dailyEmotions[date].positiveConfidence += confidence;
            dailyEmotions[date].positiveCount += 1;
          } else if (category === 'negative') {
            dailyEmotions[date].negativeConfidence += confidence;
            dailyEmotions[date].negativeCount += 1;
          }

          totalConfidence += confidence;
          emotionCount += 1;
        }
      }
    }
    
    // Push final streak if exists
    if (currentNegativeStreak > 0) {
      consecutiveNegative.push(currentNegativeStreak);
    }

    // Calculate average confidence
    const averageConfidence = emotionCount > 0 ? totalConfidence / emotionCount : 0;

    // Find dominant emotion
    let dominantEmotion = 'neutral';
    let maxCount = 0;
    for (const [emotion, count] of Object.entries(emotionCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantEmotion = emotion;
      }
    }

    // Calculate emotional stability (variance in emotions)
    const emotionVariance = Object.keys(emotionCounts).length;
    const stabilityScore = emotionCount > 0 ? Math.max(0, 100 - (emotionVariance * 10)) : 50;

    // Prepare daily trend data for charts
    const dailyTrend = Object.entries(dailyEmotions)
      .map(([date, data]) => ({
        date,
        dominantEmotion: Object.entries(data.emotions).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral',
        averageConfidence: data.count > 0 ? data.totalConfidence / data.count : 0,
        messageCount: data.count,
        emotions: data.emotions,
        wellnessScore: calculateDailyWellnessScore(data)
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Positive vs negative ratio
    let positiveCount = 0;
    let negativeCount = 0;
    let positiveConfidenceSum = 0;
    let negativeConfidenceSum = 0;
    for (const record of emotionRecords) {
      if (record.category === 'positive') {
        positiveCount++;
        positiveConfidenceSum += record.confidence;
      } else if (record.category === 'negative') {
        negativeCount++;
        negativeConfidenceSum += record.confidence;
      }
    }
    const positivityRatio = (positiveCount + negativeCount) > 0 
      ? positiveCount / (positiveCount + negativeCount) 
      : 0.5;

    // === MENTAL HEALTH ASSESSMENT ===
    const mentalHealthAssessment = calculateMentalHealthAssessment({
      emotionRecords,
      emotionCounts,
      positiveCount,
      negativeCount,
      positiveConfidenceSum,
      negativeConfidenceSum,
      highSeverityCount,
      moderateSeverityCount,
      consecutiveNegative,
      averageConfidence,
      stabilityScore,
      positivityRatio,
      dailyTrend
    });

    // === AI INSIGHTS GENERATION ===
    const insights = generateAIInsights({
      emotionRecords,
      emotionCounts,
      dominantEmotion,
      positivityRatio,
      stabilityScore,
      mentalHealthAssessment,
      dailyTrend
    });

    return res.json({
      success: true,
      analytics: {
        period: `${daysNum} days`,
        totalMessages: emotionCount,
        averageConfidence,
        dominantEmotion,
        stabilityScore,
        positivityRatio,
        emotionDistribution: emotionCounts,
        dailyTrend,
        recentEmotions: emotionRecords.slice(-20).reverse(),
        // NEW: Enhanced mental health assessment
        mentalHealthAssessment,
        // NEW: AI-generated insights
        insights
      }
    });

  } catch (error) {
    console.error('Get emotion analytics error:', error);
    return res.status(500).json({ message: 'Failed to get emotion analytics' });
  }
};

// Calculate daily wellness score (0-100)
function calculateDailyWellnessScore(dayData) {
  if (dayData.count === 0) return 50;
  
  const positiveWeight = dayData.positiveCount > 0 
    ? (dayData.positiveConfidence / dayData.positiveCount) 
    : 0;
  const negativeWeight = dayData.negativeCount > 0 
    ? (dayData.negativeConfidence / dayData.negativeCount) 
    : 0;
  
  // Base score of 50, adjusted by emotion balance
  const emotionBalance = (dayData.positiveCount - dayData.negativeCount) / dayData.count;
  const confidenceImpact = (positiveWeight - negativeWeight) * 25;
  
  return Math.min(100, Math.max(0, 50 + (emotionBalance * 25) + confidenceImpact));
}

// Calculate comprehensive mental health assessment
function calculateMentalHealthAssessment(data) {
  const {
    emotionRecords,
    emotionCounts,
    positiveCount,
    negativeCount,
    positiveConfidenceSum,
    negativeConfidenceSum,
    highSeverityCount,
    moderateSeverityCount,
    consecutiveNegative,
    averageConfidence,
    stabilityScore,
    positivityRatio,
    dailyTrend
  } = data;

  const totalEmotions = emotionRecords.length;
  if (totalEmotions === 0) {
    return {
      overallScore: 50,
      level: 'unknown',
      riskLevel: 'low',
      indicators: [],
      recommendations: ['Start chatting to receive personalized mental health insights.']
    };
  }

  // === Calculate individual scores ===
  
  // 1. Emotional Balance Score (0-100)
  const avgPositiveConf = positiveCount > 0 ? positiveConfidenceSum / positiveCount : 0;
  const avgNegativeConf = negativeCount > 0 ? negativeConfidenceSum / negativeCount : 0;
  const emotionalBalance = (positivityRatio * 60) + 
    (avgPositiveConf * 20) - 
    (avgNegativeConf * 20) + 20;
  const emotionalBalanceScore = Math.min(100, Math.max(0, emotionalBalance));

  // 2. Emotional Intensity Score (based on confidence - high confidence in negative = concerning)
  const negativeIntensity = negativeCount > 0 ? avgNegativeConf : 0;
  const intensityScore = 100 - (negativeIntensity * 50); // Lower is more concerning

  // 3. Severity Risk Score
  const severityRatio = totalEmotions > 0 
    ? ((highSeverityCount * 2) + moderateSeverityCount) / totalEmotions 
    : 0;
  const severityScore = 100 - (severityRatio * 100);

  // 4. Persistence Score (consecutive negative emotions)
  const maxNegativeStreak = consecutiveNegative.length > 0 ? Math.max(...consecutiveNegative) : 0;
  const avgNegativeStreak = consecutiveNegative.length > 0 
    ? consecutiveNegative.reduce((a, b) => a + b, 0) / consecutiveNegative.length 
    : 0;
  const persistenceScore = 100 - Math.min(100, (maxNegativeStreak * 10) + (avgNegativeStreak * 5));

  // 5. Trend Score (are things improving or declining?)
  let trendScore = 50;
  if (dailyTrend.length >= 3) {
    const recentDays = dailyTrend.slice(-7);
    const firstHalf = recentDays.slice(0, Math.floor(recentDays.length / 2));
    const secondHalf = recentDays.slice(Math.floor(recentDays.length / 2));
    
    const firstHalfAvg = firstHalf.reduce((sum, d) => sum + (d.wellnessScore || 50), 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, d) => sum + (d.wellnessScore || 50), 0) / secondHalf.length;
    
    trendScore = 50 + ((secondHalfAvg - firstHalfAvg) / 2);
    trendScore = Math.min(100, Math.max(0, trendScore));
  }

  // === Calculate Overall Mental Health Score ===
  const overallScore = Math.round(
    (emotionalBalanceScore * 0.25) +
    (intensityScore * 0.15) +
    (severityScore * 0.20) +
    (persistenceScore * 0.15) +
    (stabilityScore * 0.10) +
    (trendScore * 0.15)
  );

  // === Determine Level and Risk ===
  let level, levelDescription, riskLevel;
  if (overallScore >= 80) {
    level = 'thriving';
    levelDescription = 'Your emotional well-being is excellent! Keep nurturing your positive habits.';
    riskLevel = 'minimal';
  } else if (overallScore >= 65) {
    level = 'healthy';
    levelDescription = 'You\'re doing well overall with good emotional balance.';
    riskLevel = 'low';
  } else if (overallScore >= 50) {
    level = 'moderate';
    levelDescription = 'Your emotional state is balanced but has room for improvement.';
    riskLevel = 'moderate';
  } else if (overallScore >= 35) {
    level = 'concerning';
    levelDescription = 'You may be experiencing some emotional challenges. Consider seeking support.';
    riskLevel = 'elevated';
  } else {
    level = 'needs_attention';
    levelDescription = 'Your emotional patterns indicate you may benefit from professional support.';
    riskLevel = 'high';
  }

  // === Generate Indicators ===
  const indicators = [];
  
  if (positivityRatio < 0.3) {
    indicators.push({
      type: 'warning',
      area: 'emotional_balance',
      message: 'Your conversations show predominantly negative emotions',
      confidence: avgNegativeConf
    });
  } else if (positivityRatio > 0.7) {
    indicators.push({
      type: 'positive',
      area: 'emotional_balance',
      message: 'Great emotional balance with predominantly positive expressions',
      confidence: avgPositiveConf
    });
  }

  if (maxNegativeStreak >= 5) {
    indicators.push({
      type: 'warning',
      area: 'persistence',
      message: `Extended period of negative emotions detected (${maxNegativeStreak} consecutive messages)`,
      confidence: avgNegativeConf
    });
  }

  if (highSeverityCount > totalEmotions * 0.3) {
    indicators.push({
      type: 'alert',
      area: 'severity',
      message: 'High emotional intensity detected frequently',
      confidence: highSeverityCount / totalEmotions
    });
  }

  if (trendScore > 60) {
    indicators.push({
      type: 'positive',
      area: 'trend',
      message: 'Your emotional well-being is improving over time!',
      confidence: (trendScore - 50) / 50
    });
  } else if (trendScore < 40) {
    indicators.push({
      type: 'warning',
      area: 'trend',
      message: 'There\'s been a declining trend in your emotional well-being',
      confidence: (50 - trendScore) / 50
    });
  }

  // === Generate Recommendations ===
  const recommendations = [];
  
  if (overallScore < 50) {
    recommendations.push('Consider speaking with a mental health professional for personalized support.');
  }
  
  if (positivityRatio < 0.4) {
    recommendations.push('Try incorporating gratitude journaling to help balance negative thought patterns.');
  }
  
  if (maxNegativeStreak >= 3) {
    recommendations.push('Practice grounding techniques when you notice negative emotions building up.');
  }
  
  if (emotionCounts['fear'] && emotionCounts['fear'] > totalEmotions * 0.2) {
    recommendations.push('Mindfulness and deep breathing exercises can help manage anxiety and fear.');
  }
  
  if (emotionCounts['anger'] && emotionCounts['anger'] > totalEmotions * 0.2) {
    recommendations.push('Physical exercise and assertive communication can help channel anger constructively.');
  }
  
  if (emotionCounts['sadness'] && emotionCounts['sadness'] > totalEmotions * 0.3) {
    recommendations.push('Stay connected with supportive people and engage in activities you enjoy.');
  }
  
  if (stabilityScore < 40) {
    recommendations.push('Emotional fluctuations detected. A consistent daily routine may help stabilize your mood.');
  }

  if (recommendations.length === 0) {
    recommendations.push('Keep up your positive habits and continue engaging in self-care activities!');
  }

  return {
    overallScore,
    level,
    levelDescription,
    riskLevel,
    scores: {
      emotionalBalance: Math.round(emotionalBalanceScore),
      intensity: Math.round(intensityScore),
      severity: Math.round(severityScore),
      persistence: Math.round(persistenceScore),
      stability: Math.round(stabilityScore),
      trend: Math.round(trendScore)
    },
    indicators,
    recommendations,
    metadata: {
      totalEmotionsAnalyzed: totalEmotions,
      positiveRatio: positivityRatio,
      negativeRatio: negativeCount / totalEmotions,
      highSeverityRatio: highSeverityCount / totalEmotions,
      maxNegativeStreak,
      averageConfidence
    }
  };
}

// Generate AI insights based on emotional patterns
function generateAIInsights(data) {
  const {
    emotionRecords,
    emotionCounts,
    dominantEmotion,
    positivityRatio,
    stabilityScore,
    mentalHealthAssessment,
    dailyTrend
  } = data;

  const insights = [];
  const totalEmotions = emotionRecords.length;

  if (totalEmotions === 0) {
    return [{
      type: 'info',
      category: 'getting_started',
      title: 'Start Your Journey',
      description: 'Begin chatting to receive personalized emotional insights and track your mental wellness.',
      actionable: 'Send your first message to get started!',
      confidence: 1.0
    }];
  }

  // Dominant emotion insight
  const dominantPercentage = emotionCounts[dominantEmotion] ? 
    Math.round((emotionCounts[dominantEmotion] / totalEmotions) * 100) : 0;
  
  insights.push({
    type: dominantEmotion === 'joy' || dominantEmotion === 'love' ? 'positive' : 'observation',
    category: 'pattern',
    title: `${capitalize(dominantEmotion)} is Your Primary Emotion`,
    description: `${dominantPercentage}% of your messages reflect ${dominantEmotion}. ${getEmotionInsight(dominantEmotion)}`,
    actionable: getEmotionAction(dominantEmotion),
    confidence: dominantPercentage / 100
  });

  // Trend insight
  if (dailyTrend.length >= 3) {
    const recentScores = dailyTrend.slice(-7).map(d => d.wellnessScore || 50);
    const avgScore = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
    const trend = recentScores[recentScores.length - 1] - recentScores[0];
    
    if (trend > 10) {
      insights.push({
        type: 'positive',
        category: 'progress',
        title: 'Positive Momentum Detected',
        description: `Your emotional wellness has improved by ${Math.abs(Math.round(trend))}% over the past week. You're making great progress!`,
        actionable: 'Keep up the great work and continue your positive practices!',
        confidence: Math.min(1, Math.abs(trend) / 50)
      });
    } else if (trend < -10) {
      insights.push({
        type: 'attention',
        category: 'progress',
        title: 'Emotional Dip Noticed',
        description: `Your wellness score has decreased by ${Math.abs(Math.round(trend))}% recently. This is a normal part of life's journey.`,
        actionable: 'Consider what might be causing stress and practice extra self-care.',
        confidence: Math.min(1, Math.abs(trend) / 50)
      });
    }
  }

  // Emotional diversity insight
  const uniqueEmotions = Object.keys(emotionCounts).length;
  if (uniqueEmotions >= 5) {
    insights.push({
      type: 'observation',
      category: 'awareness',
      title: 'Rich Emotional Range',
      description: `You express ${uniqueEmotions} different emotions, showing strong emotional awareness and expression.`,
      actionable: 'Continue acknowledging and expressing your full range of emotions.',
      confidence: Math.min(1, uniqueEmotions / 6)
    });
  } else if (uniqueEmotions <= 2 && totalEmotions >= 10) {
    insights.push({
      type: 'attention',
      category: 'awareness',
      title: 'Limited Emotional Expression',
      description: 'Your conversations show a narrow emotional range. Exploring more emotions can improve self-understanding.',
      actionable: 'Try naming and describing your feelings in more detail during conversations.',
      confidence: 0.7
    });
  }

  // Confidence-based insights
  const highConfidenceNegative = emotionRecords.filter(
    e => e.category === 'negative' && e.confidence > 0.8
  ).length;
  
  if (highConfidenceNegative > totalEmotions * 0.2) {
    insights.push({
      type: 'attention',
      category: 'intensity',
      title: 'Strong Negative Emotions Detected',
      description: `${Math.round((highConfidenceNegative / totalEmotions) * 100)}% of your messages show intense negative emotions (high confidence).`,
      actionable: 'When experiencing strong negative emotions, try the 5-4-3-2-1 grounding technique.',
      confidence: highConfidenceNegative / totalEmotions
    });
  }

  // Stability insight
  if (stabilityScore >= 70) {
    insights.push({
      type: 'positive',
      category: 'stability',
      title: 'Emotionally Consistent',
      description: 'Your emotional patterns show healthy consistency, which is a sign of emotional stability.',
      actionable: 'This stability is a strength - maintain your current routines and self-care practices.',
      confidence: stabilityScore / 100
    });
  } else if (stabilityScore < 40) {
    insights.push({
      type: 'observation',
      category: 'stability',
      title: 'Emotional Fluctuations',
      description: 'Your emotions vary significantly, which might feel overwhelming at times.',
      actionable: 'A consistent daily routine with regular sleep, meals, and activities can help stabilize your mood.',
      confidence: 1 - (stabilityScore / 100)
    });
  }

  return insights;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getEmotionInsight(emotion) {
  const insights = {
    joy: 'This positive outlook can boost resilience and improve overall well-being.',
    sadness: 'Processing sadness is healthy, but persistent sadness may need attention.',
    anger: 'Anger often signals unmet needs or boundary violations worth exploring.',
    fear: 'Fear can be protective, but frequent fear may indicate anxiety.',
    love: 'Expressing love and connection strengthens emotional health.',
    surprise: 'Openness to surprise shows adaptability to life\'s changes.',
    neutral: 'Balanced emotional expression is healthy and grounded.'
  };
  return insights[emotion] || '';
}

function getEmotionAction(emotion) {
  const actions = {
    joy: 'Keep engaging in activities that bring you happiness!',
    sadness: 'Consider journaling or talking to someone about what\'s weighing on you.',
    anger: 'Try identifying the unmet need behind your anger and address it directly.',
    fear: 'Practice grounding techniques and gradually face smaller fears.',
    love: 'Continue nurturing your meaningful relationships.',
    surprise: 'Stay curious and embrace new experiences.',
    neutral: 'Explore what might help you feel more engaged emotionally.'
  };
  return actions[emotion] || '';
}

// Get progress tracking data
exports.getProgressTracking = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get user with goals
    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Calculate goal progress with enhanced metrics
    const goals = (user.goals || []).map(goal => {
      const daysActive = Math.floor((new Date() - new Date(goal.createdAt)) / (1000 * 60 * 60 * 24));
      const isOverdue = goal.targetDate && new Date(goal.targetDate) < new Date() && goal.status !== 'completed';
      const daysUntilDeadline = goal.targetDate 
        ? Math.ceil((new Date(goal.targetDate) - new Date()) / (1000 * 60 * 60 * 24))
        : null;
      
      return {
        ...goal,
        daysActive,
        isOverdue,
        daysUntilDeadline,
        urgency: daysUntilDeadline !== null && daysUntilDeadline <= 3 && goal.status === 'active' ? 'high' : 
                 daysUntilDeadline !== null && daysUntilDeadline <= 7 && goal.status === 'active' ? 'medium' : 'low'
      };
    });

    const activeGoals = goals.filter(g => g.status === 'active').length;
    const completedGoals = goals.filter(g => g.status === 'completed').length;
    const pausedGoals = goals.filter(g => g.status === 'paused').length;
    const overdueGoals = goals.filter(g => g.isOverdue).length;
    const goalCompletionRate = goals.length > 0 ? completedGoals / goals.length : 0;

    // Get all sessions for streak calculation
    const allSessions = await ChatSession.find({
      user: userId
    }).sort({ createdAt: -1 }).select('createdAt').lean();

    // Calculate streak
    const streakData = calculateStreak(allSessions);

    // Get emotion data for multiple time periods
    const periods = [7, 14, 30];
    const emotionsByPeriod = {};
    
    for (const days of periods) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const sessions = await ChatSession.find({
        user: userId,
        createdAt: { $gte: startDate }
      }).select('_id').lean();

      const buckets = await ChatMessageBucket.find({
        session: { $in: sessions.map(s => s._id) },
        user: userId
      }).lean();

      const emotions = [];
      for (const bucket of buckets) {
        if (!Array.isArray(bucket.messages)) continue;
        for (const msg of bucket.messages) {
          if (msg.role === 'user' && msg.emotionData) {
            emotions.push({
              emotion: msg.emotionData.emotion,
              confidence: msg.emotionData.confidence,
              category: msg.emotionData.category,
              severity: msg.emotionData.severity,
              timestamp: msg.createdAt
            });
          }
        }
      }
      
      emotionsByPeriod[days] = emotions;
    }

    // Calculate mood scores for each period
    const moodScores = {};
    for (const [period, emotions] of Object.entries(emotionsByPeriod)) {
      moodScores[period] = calculateMoodScore(emotions);
    }

    // Calculate weekly progress comparison
    const thisWeekScore = moodScores[7].score;
    const lastWeekEmotions = emotionsByPeriod[14].filter(e => {
      const date = new Date(e.timestamp);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 14);
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      return date >= twoWeeksAgo && date < weekAgo;
    });
    const lastWeekScore = calculateMoodScore(lastWeekEmotions).score;
    const weeklyChange = thisWeekScore - lastWeekScore;

    // Calculate milestones
    const milestones = calculateMilestones({
      user,
      goals,
      streakData,
      totalMessages: emotionsByPeriod[30].length,
      completedGoals,
      moodScores
    });

    // Calculate engagement metrics
    const engagementMetrics = calculateEngagementMetrics(allSessions, emotionsByPeriod[30]);

    // Personal best tracking
    const personalBests = {
      longestStreak: user.stats?.longestStreak || streakData.currentStreak,
      highestMoodScore: user.stats?.highestMoodScore || thisWeekScore,
      mostActiveDay: user.stats?.mostActiveDay || getMostActiveDay(allSessions),
      totalGoalsCompleted: completedGoals,
      totalConversations: allSessions.length
    };

    return res.json({
      success: true,
      progress: {
        // Goals section
        goals: {
          total: goals.length,
          active: activeGoals,
          completed: completedGoals,
          paused: pausedGoals,
          overdue: overdueGoals,
          completionRate: goalCompletionRate,
          list: goals.sort((a, b) => {
            // Sort by: overdue first, then by urgency, then by creation date
            if (a.isOverdue && !b.isOverdue) return -1;
            if (!a.isOverdue && b.isOverdue) return 1;
            const urgencyOrder = { high: 0, medium: 1, low: 2 };
            return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
          })
        },
        
        // Mood tracking
        mood: {
          current: {
            score: Math.round(thisWeekScore),
            label: getMoodLabel(thisWeekScore),
            color: getMoodColor(thisWeekScore)
          },
          weeklyChange: Math.round(weeklyChange),
          trend: weeklyChange > 5 ? 'improving' : weeklyChange < -5 ? 'declining' : 'stable',
          byPeriod: {
            week: moodScores[7],
            twoWeeks: moodScores[14],
            month: moodScores[30]
          }
        },
        
        // Streak data
        streak: streakData,
        
        // Milestones
        milestones,
        
        // Engagement metrics
        engagement: engagementMetrics,
        
        // Personal bests
        personalBests,
        
        // Quick stats for dashboard
        quickStats: {
          currentMood: getMoodLabel(thisWeekScore),
          streakDays: streakData.currentStreak,
          goalsActive: activeGoals,
          weeklyProgress: weeklyChange > 0 ? `+${Math.round(weeklyChange)}%` : `${Math.round(weeklyChange)}%`
        },
        
        // Recommendations based on progress
        recommendations: generateProgressRecommendations({
          moodScores,
          streakData,
          goals,
          engagementMetrics,
          weeklyChange
        }),
        
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Get progress tracking error:', error);
    return res.status(500).json({ message: 'Failed to get progress data' });
  }
};

// Calculate streak from sessions
function calculateStreak(sessions) {
  if (!sessions || sessions.length === 0) {
    return { currentStreak: 0, longestStreak: 0, lastActiveDate: null, isActiveToday: false };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Get unique dates
  const uniqueDates = [...new Set(sessions.map(s => {
    const d = new Date(s.createdAt);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }))].sort((a, b) => b - a); // Sort descending (newest first)

  const isActiveToday = uniqueDates[0] === today.getTime();
  
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  let lastDate = null;

  for (const dateTime of uniqueDates) {
    const date = new Date(dateTime);
    
    if (lastDate === null) {
      // First date
      if (isActiveToday || (today.getTime() - dateTime <= 86400000)) {
        tempStreak = 1;
        currentStreak = 1;
      }
    } else {
      const daysDiff = (lastDate - dateTime) / 86400000;
      
      if (daysDiff === 1) {
        tempStreak++;
        if (currentStreak > 0) currentStreak++;
      } else {
        // Streak broken
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
        if (currentStreak > 0) currentStreak = 0; // Current streak broken
      }
    }
    
    lastDate = dateTime;
  }
  
  longestStreak = Math.max(longestStreak, tempStreak);

  return {
    currentStreak,
    longestStreak,
    lastActiveDate: sessions[0]?.createdAt || null,
    isActiveToday,
    daysThisWeek: uniqueDates.filter(d => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      weekAgo.setHours(0, 0, 0, 0);
      return d >= weekAgo.getTime();
    }).length
  };
}

// Calculate mood score from emotions
function calculateMoodScore(emotions) {
  if (!emotions || emotions.length === 0) {
    return { score: 50, label: 'No data', color: '#9CA3AF', totalMessages: 0 };
  }

  let positiveWeight = 0;
  let negativeWeight = 0;
  let positiveCount = 0;
  let negativeCount = 0;

  for (const e of emotions) {
    if (e.category === 'positive') {
      positiveWeight += e.confidence || 0.5;
      positiveCount++;
    } else if (e.category === 'negative') {
      negativeWeight += e.confidence || 0.5;
      negativeCount++;
    }
  }

  // Mood score formula: base 50, adjusted by emotion balance and confidence
  const total = positiveCount + negativeCount;
  let score = 50;
  
  if (total > 0) {
    const balance = (positiveCount - negativeCount) / total;
    const avgPositiveConf = positiveCount > 0 ? positiveWeight / positiveCount : 0;
    const avgNegativeConf = negativeCount > 0 ? negativeWeight / negativeCount : 0;
    const confidenceImpact = (avgPositiveConf - avgNegativeConf) * 25;
    
    score = 50 + (balance * 30) + confidenceImpact;
    score = Math.min(100, Math.max(0, score));
  }

  return {
    score: Math.round(score),
    label: getMoodLabel(score),
    color: getMoodColor(score),
    totalMessages: emotions.length,
    positiveRatio: total > 0 ? positiveCount / total : 0.5,
    avgConfidence: emotions.reduce((sum, e) => sum + (e.confidence || 0), 0) / emotions.length
  };
}

function getMoodLabel(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 65) return 'Good';
  if (score >= 50) return 'Okay';
  if (score >= 35) return 'Low';
  return 'Struggling';
}

function getMoodColor(score) {
  if (score >= 80) return '#10B981';
  if (score >= 65) return '#34D399';
  if (score >= 50) return '#F59E0B';
  if (score >= 35) return '#F97316';
  return '#EF4444';
}

function getMostActiveDay(sessions) {
  const dayCounts = {};
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  for (const session of sessions) {
    const day = days[new Date(session.createdAt).getDay()];
    dayCounts[day] = (dayCounts[day] || 0) + 1;
  }
  
  let maxDay = 'Monday';
  let maxCount = 0;
  for (const [day, count] of Object.entries(dayCounts)) {
    if (count > maxCount) {
      maxCount = count;
      maxDay = day;
    }
  }
  
  return maxDay;
}

// Calculate milestones
function calculateMilestones(data) {
  const { user, goals, streakData, totalMessages, completedGoals, moodScores } = data;
  const milestones = [];
  const earnedBadges = [];

  // Streak milestones
  if (streakData.currentStreak >= 7) {
    earnedBadges.push({ id: 'streak_7', name: '7-Day Streak', icon: '🔥', earnedAt: new Date() });
  }
  if (streakData.currentStreak >= 30) {
    earnedBadges.push({ id: 'streak_30', name: 'Monthly Champion', icon: '🏆', earnedAt: new Date() });
  }
  if (streakData.longestStreak >= 14) {
    earnedBadges.push({ id: 'streak_14', name: 'Two-Week Warrior', icon: '⚔️', earnedAt: new Date() });
  }

  // Message milestones
  if (totalMessages >= 10) {
    earnedBadges.push({ id: 'messages_10', name: 'Opening Up', icon: '💬', earnedAt: new Date() });
  }
  if (totalMessages >= 50) {
    earnedBadges.push({ id: 'messages_50', name: 'Deep Talker', icon: '🗣️', earnedAt: new Date() });
  }
  if (totalMessages >= 100) {
    earnedBadges.push({ id: 'messages_100', name: 'Conversation Master', icon: '👑', earnedAt: new Date() });
  }

  // Goal milestones
  if (completedGoals >= 1) {
    earnedBadges.push({ id: 'goal_1', name: 'First Victory', icon: '🎯', earnedAt: new Date() });
  }
  if (completedGoals >= 5) {
    earnedBadges.push({ id: 'goal_5', name: 'Goal Crusher', icon: '💪', earnedAt: new Date() });
  }

  // Mood milestones
  if (moodScores[7]?.score >= 80) {
    earnedBadges.push({ id: 'mood_high', name: 'Positive Vibes', icon: '✨', earnedAt: new Date() });
  }

  // Progress milestones (check improvements)
  const upcoming = [];
  
  if (streakData.currentStreak < 7) {
    upcoming.push({
      id: 'streak_7',
      name: '7-Day Streak',
      icon: '🔥',
      progress: streakData.currentStreak,
      target: 7,
      percentage: Math.round((streakData.currentStreak / 7) * 100)
    });
  }
  
  if (totalMessages < 50) {
    upcoming.push({
      id: 'messages_50',
      name: 'Deep Talker',
      icon: '🗣️',
      progress: totalMessages,
      target: 50,
      percentage: Math.round((totalMessages / 50) * 100)
    });
  }
  
  if (completedGoals < 5) {
    upcoming.push({
      id: 'goal_5',
      name: 'Goal Crusher',
      icon: '💪',
      progress: completedGoals,
      target: 5,
      percentage: Math.round((completedGoals / 5) * 100)
    });
  }

  return {
    earned: earnedBadges,
    upcoming: upcoming.slice(0, 3), // Top 3 upcoming milestones
    totalEarned: earnedBadges.length,
    nextMilestone: upcoming[0] || null
  };
}

// Calculate engagement metrics
function calculateEngagementMetrics(sessions, monthlyEmotions) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const weekSessions = sessions.filter(s => new Date(s.createdAt) >= weekAgo);
  const monthSessions = sessions.filter(s => new Date(s.createdAt) >= monthAgo);

  // Calculate average session frequency
  const avgSessionsPerWeek = monthSessions.length > 0 ? (monthSessions.length / 4) : 0;

  // Calculate consistency (how evenly distributed are the sessions)
  const dayDistribution = {};
  for (const session of monthSessions) {
    const day = new Date(session.createdAt).toISOString().split('T')[0];
    dayDistribution[day] = (dayDistribution[day] || 0) + 1;
  }
  const activeDays = Object.keys(dayDistribution).length;
  const consistencyScore = Math.min(100, (activeDays / 30) * 100);

  return {
    sessionsThisWeek: weekSessions.length,
    sessionsThisMonth: monthSessions.length,
    avgSessionsPerWeek: Math.round(avgSessionsPerWeek * 10) / 10,
    activeDaysThisMonth: activeDays,
    consistencyScore: Math.round(consistencyScore),
    messagesThisMonth: monthlyEmotions.length,
    engagementLevel: consistencyScore >= 70 ? 'high' : consistencyScore >= 40 ? 'medium' : 'low'
  };
}

// Generate progress recommendations
function generateProgressRecommendations(data) {
  const { moodScores, streakData, goals, engagementMetrics, weeklyChange } = data;
  const recommendations = [];

  // Streak-based recommendations
  if (streakData.currentStreak === 0) {
    recommendations.push({
      type: 'action',
      priority: 'high',
      title: 'Start Your Streak',
      description: 'Check in daily to build a consistent self-care habit.',
      action: 'Start a conversation today!'
    });
  } else if (streakData.currentStreak >= 3 && streakData.currentStreak < 7) {
    recommendations.push({
      type: 'encouragement',
      priority: 'medium',
      title: `${7 - streakData.currentStreak} Days to 7-Day Badge!`,
      description: 'You\'re building a great habit. Keep going!',
      action: 'Check in tomorrow to continue your streak.'
    });
  }

  // Mood-based recommendations
  if (weeklyChange < -10) {
    recommendations.push({
      type: 'support',
      priority: 'high',
      title: 'We Noticed a Dip',
      description: 'Your mood has decreased recently. This is a normal part of life.',
      action: 'Consider practicing a grounding exercise or reaching out to someone you trust.'
    });
  } else if (weeklyChange > 10) {
    recommendations.push({
      type: 'celebration',
      priority: 'low',
      title: 'Great Progress!',
      description: `Your mood improved by ${Math.round(weeklyChange)}% this week!`,
      action: 'Take a moment to appreciate your growth.'
    });
  }

  // Goal-based recommendations
  const activeGoals = goals.filter(g => g.status === 'active');
  const overdueGoals = goals.filter(g => g.isOverdue);
  
  if (overdueGoals.length > 0) {
    recommendations.push({
      type: 'action',
      priority: 'high',
      title: `${overdueGoals.length} Goal(s) Need Attention`,
      description: 'Some goals have passed their target date.',
      action: 'Review and update your goals in the Progress tab.'
    });
  } else if (activeGoals.length === 0 && goals.length === 0) {
    recommendations.push({
      type: 'suggestion',
      priority: 'medium',
      title: 'Set Your First Goal',
      description: 'Goals help you track your personal growth journey.',
      action: 'Add a goal to start tracking your progress.'
    });
  }

  // Engagement recommendations
  if (engagementMetrics.consistencyScore < 40) {
    recommendations.push({
      type: 'suggestion',
      priority: 'medium',
      title: 'Build Consistency',
      description: 'Regular check-ins lead to better emotional awareness.',
      action: 'Try setting a daily reminder to chat.'
    });
  }

  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  }).slice(0, 3);
}

// ==================== GOALS MANAGEMENT ====================

// Create a new goal
exports.createGoal = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { title, category, targetDate, description } = req.body;

    if (!title || !category) {
      return res.status(400).json({ message: 'Title and category are required' });
    }

    const validCategories = ['mental_health', 'personal_growth', 'relationships', 'career', 'health', 'other'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ message: 'Invalid category' });
    }

    const newGoal = {
      title: title.trim(),
      category,
      description: description?.trim() || '',
      status: 'active',
      progress: 0,
      createdAt: new Date(),
      targetDate: targetDate ? new Date(targetDate) : null,
      milestones: [],
      notes: []
    };

    const user = await User.findByIdAndUpdate(
      userId,
      { $push: { goals: newGoal } },
      { new: true }
    ).lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const createdGoal = user.goals[user.goals.length - 1];

    return res.status(201).json({
      success: true,
      message: 'Goal created successfully',
      goal: createdGoal
    });

  } catch (error) {
    console.error('Create goal error:', error);
    return res.status(500).json({ message: 'Failed to create goal' });
  }
};

// Update a goal
exports.updateGoal = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { goalId } = req.params;
    const { title, category, targetDate, status, description } = req.body;

    const updateFields = {};
    if (title) updateFields['goals.$.title'] = title.trim();
    if (category) updateFields['goals.$.category'] = category;
    if (targetDate !== undefined) updateFields['goals.$.targetDate'] = targetDate ? new Date(targetDate) : null;
    if (status) updateFields['goals.$.status'] = status;
    if (description !== undefined) updateFields['goals.$.description'] = description.trim();
    if (status === 'completed') updateFields['goals.$.completedAt'] = new Date();

    const user = await User.findOneAndUpdate(
      { _id: userId, 'goals._id': goalId },
      { $set: updateFields },
      { new: true }
    ).lean();

    if (!user) {
      return res.status(404).json({ message: 'Goal not found' });
    }

    const updatedGoal = user.goals.find(g => g._id.toString() === goalId);

    return res.json({
      success: true,
      message: 'Goal updated successfully',
      goal: updatedGoal
    });

  } catch (error) {
    console.error('Update goal error:', error);
    return res.status(500).json({ message: 'Failed to update goal' });
  }
};

// Delete a goal
exports.deleteGoal = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { goalId } = req.params;

    const user = await User.findByIdAndUpdate(
      userId,
      { $pull: { goals: { _id: goalId } } },
      { new: true }
    ).lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      success: true,
      message: 'Goal deleted successfully'
    });

  } catch (error) {
    console.error('Delete goal error:', error);
    return res.status(500).json({ message: 'Failed to delete goal' });
  }
};

// Update goal progress
exports.updateGoalProgress = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { goalId } = req.params;
    const { progress, note } = req.body;

    if (progress === undefined || progress < 0 || progress > 100) {
      return res.status(400).json({ message: 'Progress must be between 0 and 100' });
    }

    const updateFields = {
      'goals.$.progress': progress
    };

    // Auto-complete if progress reaches 100
    if (progress >= 100) {
      updateFields['goals.$.status'] = 'completed';
      updateFields['goals.$.completedAt'] = new Date();
    }

    // Add progress note if provided
    const updateOps = { $set: updateFields };
    if (note) {
      updateOps.$push = {
        'goals.$.notes': {
          text: note,
          progress,
          createdAt: new Date()
        }
      };
    }

    const user = await User.findOneAndUpdate(
      { _id: userId, 'goals._id': goalId },
      updateOps,
      { new: true }
    ).lean();

    if (!user) {
      return res.status(404).json({ message: 'Goal not found' });
    }

    const updatedGoal = user.goals.find(g => g._id.toString() === goalId);

    return res.json({
      success: true,
      message: progress >= 100 ? 'Congratulations! Goal completed!' : 'Progress updated',
      goal: updatedGoal
    });

  } catch (error) {
    console.error('Update goal progress error:', error);
    return res.status(500).json({ message: 'Failed to update progress' });
  }
};

// ==================== MENTAL HEALTH SUMMARY ====================

// Get comprehensive mental health summary (for dashboard)
exports.getMentalHealthSummary = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get user data
    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get sessions from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sessions = await ChatSession.find({
      user: userId,
      createdAt: { $gte: thirtyDaysAgo }
    }).sort({ createdAt: -1 }).select('_id createdAt').lean();

    const buckets = await ChatMessageBucket.find({
      session: { $in: sessions.map(s => s._id) },
      user: userId
    }).lean();

    // Collect all emotions
    const emotions = [];
    for (const bucket of buckets) {
      if (!Array.isArray(bucket.messages)) continue;
      for (const msg of bucket.messages) {
        if (msg.role === 'user' && msg.emotionData) {
          emotions.push({
            emotion: msg.emotionData.emotion,
            confidence: msg.emotionData.confidence,
            category: msg.emotionData.category,
            severity: msg.emotionData.severity,
            timestamp: msg.createdAt
          });
        }
      }
    }

    // Calculate key metrics
    const totalEmotions = emotions.length;
    const positiveEmotions = emotions.filter(e => e.category === 'positive');
    const negativeEmotions = emotions.filter(e => e.category === 'negative');
    const highSeverity = emotions.filter(e => e.severity === 'high');

    // Average confidence for positive vs negative
    const avgPositiveConf = positiveEmotions.length > 0
      ? positiveEmotions.reduce((sum, e) => sum + e.confidence, 0) / positiveEmotions.length
      : 0;
    const avgNegativeConf = negativeEmotions.length > 0
      ? negativeEmotions.reduce((sum, e) => sum + e.confidence, 0) / negativeEmotions.length
      : 0;

    // Calculate mental wellness score (0-100)
    let wellnessScore = 50;
    if (totalEmotions > 0) {
      const positivityRatio = positiveEmotions.length / totalEmotions;
      const severityPenalty = (highSeverity.length / totalEmotions) * 20;
      const confidenceBonus = (avgPositiveConf - avgNegativeConf) * 15;
      
      wellnessScore = 50 + (positivityRatio * 30) - severityPenalty + confidenceBonus;
      wellnessScore = Math.min(100, Math.max(0, wellnessScore));
    }

    // Determine condition assessment
    let condition, conditionDescription, conditionColor;
    if (wellnessScore >= 80) {
      condition = 'Excellent';
      conditionDescription = 'Your mental wellness is thriving! You show strong emotional resilience and positive patterns.';
      conditionColor = '#10B981';
    } else if (wellnessScore >= 65) {
      condition = 'Good';
      conditionDescription = 'You\'re maintaining healthy emotional patterns with room for growth.';
      conditionColor = '#34D399';
    } else if (wellnessScore >= 50) {
      condition = 'Moderate';
      conditionDescription = 'Your emotional state is balanced. Focus on building more positive experiences.';
      conditionColor = '#F59E0B';
    } else if (wellnessScore >= 35) {
      condition = 'Needs Attention';
      conditionDescription = 'You may be experiencing emotional challenges. Consider additional support.';
      conditionColor = '#F97316';
    } else {
      condition = 'Seeking Support';
      conditionDescription = 'Your patterns suggest you might benefit from professional mental health support.';
      conditionColor = '#EF4444';
    }

    // Top emotions
    const emotionCounts = {};
    for (const e of emotions) {
      emotionCounts[e.emotion] = (emotionCounts[e.emotion] || 0) + 1;
    }
    const topEmotions = Object.entries(emotionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([emotion, count]) => ({
        emotion,
        count,
        percentage: totalEmotions > 0 ? Math.round((count / totalEmotions) * 100) : 0
      }));

    // Weekly comparison
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const thisWeekEmotions = emotions.filter(e => new Date(e.timestamp) >= weekAgo);
    const lastWeekEmotions = emotions.filter(e => {
      const date = new Date(e.timestamp);
      return date >= twoWeeksAgo && date < weekAgo;
    });

    const thisWeekScore = calculateQuickMoodScore(thisWeekEmotions);
    const lastWeekScore = calculateQuickMoodScore(lastWeekEmotions);
    const weeklyChange = thisWeekScore - lastWeekScore;

    // Goals summary
    const goals = user.goals || [];
    const activeGoals = goals.filter(g => g.status === 'active');
    const completedGoals = goals.filter(g => g.status === 'completed');

    return res.json({
      success: true,
      summary: {
        // Overall wellness
        wellness: {
          score: Math.round(wellnessScore),
          condition,
          conditionDescription,
          conditionColor,
          lastUpdated: new Date().toISOString()
        },
        
        // Confidence-based analysis
        confidenceAnalysis: {
          averageConfidence: totalEmotions > 0 
            ? emotions.reduce((sum, e) => sum + e.confidence, 0) / totalEmotions 
            : 0,
          positiveConfidence: avgPositiveConf,
          negativeConfidence: avgNegativeConf,
          interpretation: getConfidenceInterpretation(avgPositiveConf, avgNegativeConf)
        },
        
        // Emotion breakdown
        emotions: {
          total: totalEmotions,
          positive: positiveEmotions.length,
          negative: negativeEmotions.length,
          highSeverity: highSeverity.length,
          topEmotions,
          positivityRatio: totalEmotions > 0 ? positiveEmotions.length / totalEmotions : 0.5
        },
        
        // Trend
        trend: {
          thisWeekScore: Math.round(thisWeekScore),
          lastWeekScore: Math.round(lastWeekScore),
          change: Math.round(weeklyChange),
          direction: weeklyChange > 5 ? 'improving' : weeklyChange < -5 ? 'declining' : 'stable',
          message: getTrendMessage(weeklyChange)
        },
        
        // Goals overview
        goals: {
          active: activeGoals.length,
          completed: completedGoals.length,
          completionRate: goals.length > 0 ? completedGoals.length / goals.length : 0
        },
        
        // Engagement
        engagement: {
          conversationsThisMonth: sessions.length,
          messagesThisMonth: totalEmotions,
          activeDays: [...new Set(sessions.map(s => 
            new Date(s.createdAt).toISOString().split('T')[0]
          ))].length
        },
        
        // Personalized insight
        insight: generatePersonalizedInsight({
          wellnessScore,
          topEmotions,
          weeklyChange,
          avgNegativeConf,
          highSeverity: highSeverity.length,
          totalEmotions
        })
      }
    });

  } catch (error) {
    console.error('Get mental health summary error:', error);
    return res.status(500).json({ message: 'Failed to get mental health summary' });
  }
};

function calculateQuickMoodScore(emotions) {
  if (emotions.length === 0) return 50;
  
  let score = 50;
  const positive = emotions.filter(e => e.category === 'positive');
  const negative = emotions.filter(e => e.category === 'negative');
  
  const balance = (positive.length - negative.length) / emotions.length;
  score += balance * 30;
  
  return Math.min(100, Math.max(0, score));
}

function getConfidenceInterpretation(positiveConf, negativeConf) {
  if (positiveConf > 0.8 && negativeConf < 0.5) {
    return 'Strong positive emotional clarity with minimal negative intensity.';
  } else if (negativeConf > 0.8) {
    return 'High intensity negative emotions detected. Consider grounding techniques.';
  } else if (positiveConf > 0.6 && negativeConf > 0.6) {
    return 'Both positive and negative emotions are being felt intensely.';
  } else if (positiveConf < 0.5 && negativeConf < 0.5) {
    return 'Emotional expressions are subtle. Consider exploring feelings more deeply.';
  }
  return 'Balanced emotional expression across your conversations.';
}

function getTrendMessage(change) {
  if (change > 15) return 'Excellent progress! Your emotional wellness is improving significantly.';
  if (change > 5) return 'Good trend! You\'re moving in a positive direction.';
  if (change > -5) return 'Stable week. Consistency is valuable for mental health.';
  if (change > -15) return 'Slight dip this week. Remember to practice self-care.';
  return 'Challenging week. Consider reaching out for support if needed.';
}

function generatePersonalizedInsight(data) {
  const { wellnessScore, topEmotions, weeklyChange, avgNegativeConf, highSeverity, totalEmotions } = data;

  if (totalEmotions === 0) {
    return {
      title: 'Start Your Journey',
      message: 'Begin chatting to receive personalized mental health insights based on your emotional patterns.',
      type: 'info'
    };
  }

  if (wellnessScore >= 75 && weeklyChange >= 0) {
    return {
      title: 'Thriving!',
      message: 'Your emotional patterns show excellent well-being. Keep nurturing your positive habits and sharing what brings you joy.',
      type: 'positive'
    };
  }

  if (avgNegativeConf > 0.85 && highSeverity > totalEmotions * 0.3) {
    return {
      title: 'We\'re Here for You',
      message: 'Your conversations show intense emotions. Remember, it\'s okay to feel deeply. Consider speaking with a professional if these feelings persist.',
      type: 'support'
    };
  }

  if (weeklyChange < -10) {
    return {
      title: 'Rough Week?',
      message: 'Your mood has dipped recently. This is a normal part of life\'s ups and downs. Try focusing on small positive moments today.',
      type: 'encouragement'
    };
  }

  const topEmotion = topEmotions[0]?.emotion;
  if (topEmotion === 'sadness') {
    return {
      title: 'Processing Sadness',
      message: 'You\'ve been experiencing sadness frequently. It\'s healthy to process these feelings. Consider journaling or talking to someone you trust.',
      type: 'guidance'
    };
  }

  if (topEmotion === 'fear') {
    return {
      title: 'Managing Anxiety',
      message: 'Anxiety seems to be present in your conversations. Try grounding techniques: name 5 things you can see, 4 you can touch, 3 you can hear.',
      type: 'guidance'
    };
  }

  return {
    title: 'Keep Going',
    message: 'You\'re on a journey of self-awareness. Continue expressing your feelings and tracking your emotional patterns.',
    type: 'encouragement'
  };
}

