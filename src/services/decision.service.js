/**
 * Rebirth Decision Engine v2.0
 * 
 * Multi-Stage Reasoning & Decision Pipeline
 * ══════════════════════════════════════════════════════════════════
 * 
 * STEP 1: Emotional Interpretation
 * STEP 2: Temporal Reasoning (pattern over time)
 * STEP 3: Identity Alignment Check (Ideal Self vs Anti-Vision)
 * STEP 4: Memory Gating (Anti-Hallucination Control)
 * STEP 5: Decision Engine (Strategy Selection)
 * STEP 6: Ethical & Safety Constraints
 * 
 * Gemini is ONLY used for natural language generation.
 * ALL decisions are made HERE, in deterministic code.
 */

// ══════════════════════════════════════════════════════════════════
//                      CONSTANTS & MAPPINGS
// ══════════════════════════════════════════════════════════════════

// Crisis keywords for immediate safety escalation
const CRISIS_KEYWORDS = [
  'suicide', 'kill myself', 'end my life', 'want to die', 'better off dead',
  'no reason to live', 'cant go on', "can't go on", 'self harm', 'hurt myself',
  'cutting', 'overdose', 'ending it', 'goodbye forever', 'final goodbye',
  'not worth living', 'give up on life', 'disappear forever'
];

// Response strategies (STEP 5 options)
const RESPONSE_STRATEGIES = {
  EMOTIONAL_VALIDATION: 'emotional_validation',
  REFLECTIVE_LISTENING: 'reflective_listening', 
  COGNITIVE_REFRAMING: 'cognitive_reframing',
  IDENTITY_ENCOURAGEMENT: 'identity_encouragement',
  GROUNDING_REGULATION: 'grounding_regulation',
  SAFETY_ESCALATION: 'safety_escalation'
};

// Emotion intensity levels
const INTENSITY_LEVELS = {
  LOW: 'low',
  MODERATE: 'moderate', 
  HIGH: 'high'
};

// Temporal trends
const TEMPORAL_TRENDS = {
  ESCALATING: 'escalating',
  STAGNATING: 'stagnating',
  IMPROVING: 'improving',
  STABLE: 'stable'
};

// ══════════════════════════════════════════════════════════════════
//              STEP 1: EMOTIONAL INTERPRETATION
// ══════════════════════════════════════════════════════════════════

/**
 * Infer dominant emotional state, intensity, and whether acute or recurring
 */
function interpretEmotion(emotionData, emotionHistory = []) {
  const interpretation = {
    dominantEmotion: emotionData.emotion,
    confidence: emotionData.confidence,
    category: emotionData.category,
    intensity: INTENSITY_LEVELS.LOW,
    isAcute: true,
    isRecurring: false
  };

  // Determine intensity based on confidence and severity
  if (emotionData.confidence >= 0.85 || emotionData.severity === 'high') {
    interpretation.intensity = INTENSITY_LEVELS.HIGH;
  } else if (emotionData.confidence >= 0.6 || emotionData.severity === 'moderate') {
    interpretation.intensity = INTENSITY_LEVELS.MODERATE;
  }

  // Check if this emotion is recurring
  if (emotionHistory.length >= 2) {
    const sameEmotionCount = emotionHistory
      .slice(-5)
      .filter(e => e === emotionData.emotion).length;
    
    interpretation.isRecurring = sameEmotionCount >= 2;
    interpretation.isAcute = !interpretation.isRecurring;
  }

  return interpretation;
}

// ══════════════════════════════════════════════════════════════════
//              STEP 2: TEMPORAL REASONING
// ══════════════════════════════════════════════════════════════════

/**
 * Analyze emotional patterns over time to detect trends
 */
function analyzeTemporalPattern(emotionHistory = []) {
  const temporal = {
    trend: TEMPORAL_TRENDS.STABLE,
    hasEscalation: false,
    hasStagnation: false,
    hasImprovement: false,
    recentNegativeStreak: 0,
    recentPositiveStreak: 0
  };

  if (emotionHistory.length < 3) {
    return temporal;
  }

  const recent = emotionHistory.slice(-7);
  const negativeEmotions = ['sadness', 'anger', 'fear'];
  const positiveEmotions = ['joy', 'love'];

  // Count streaks
  let negativeStreak = 0;
  let positiveStreak = 0;
  
  for (let i = recent.length - 1; i >= 0; i--) {
    if (negativeEmotions.includes(recent[i])) {
      if (positiveStreak === 0) negativeStreak++;
    } else if (positiveEmotions.includes(recent[i])) {
      if (negativeStreak === 0) positiveStreak++;
    } else {
      break;
    }
  }

  temporal.recentNegativeStreak = negativeStreak;
  temporal.recentPositiveStreak = positiveStreak;

  // Analyze first half vs second half for trend
  const midpoint = Math.floor(recent.length / 2);
  const firstHalf = recent.slice(0, midpoint);
  const secondHalf = recent.slice(midpoint);

  const firstNegative = firstHalf.filter(e => negativeEmotions.includes(e)).length;
  const secondNegative = secondHalf.filter(e => negativeEmotions.includes(e)).length;

  if (secondNegative > firstNegative + 1) {
    temporal.trend = TEMPORAL_TRENDS.ESCALATING;
    temporal.hasEscalation = true;
  } else if (secondNegative < firstNegative - 1) {
    temporal.trend = TEMPORAL_TRENDS.IMPROVING;
    temporal.hasImprovement = true;
  } else if (negativeStreak >= 4) {
    temporal.trend = TEMPORAL_TRENDS.STAGNATING;
    temporal.hasStagnation = true;
  }

  return temporal;
}

// ══════════════════════════════════════════════════════════════════
//              STEP 3: IDENTITY ALIGNMENT CHECK
// ══════════════════════════════════════════════════════════════════

/**
 * Evaluate how current emotional state relates to Ideal Self and Anti-Vision
 */
function checkIdentityAlignment(message, emotionInterpretation, userContext = {}) {
  const alignment = {
    conflictsWithIdealSelf: false,
    triggersAntiVision: false,
    supportsIdealSelf: false,
    relevantIdealSelfAspect: null,
    relevantAntiVisionRisk: null,
    shouldReferenceGoal: false
  };

  const lowerMessage = message.toLowerCase();
  const idealSelf = (userContext.idealSelf || '').toLowerCase();
  const antiVision = (userContext.antiVision || '').toLowerCase();

  // Check for Anti-Vision triggers (patterns user wants to avoid)
  const antiVisionKeywords = [
    'fell back', 'did it again', 'same mistake', 'bad habit', 
    'relapsed', 'gave in', 'failed again', 'cant stop', "can't stop"
  ];

  for (const keyword of antiVisionKeywords) {
    if (lowerMessage.includes(keyword)) {
      alignment.triggersAntiVision = true;
      if (antiVision) {
        alignment.relevantAntiVisionRisk = antiVision;
      }
      break;
    }
  }

  // Check for Ideal Self alignment opportunities
  const goalKeywords = [
    'want to', 'trying to', 'working on', 'goal', 'improve',
    'become', 'achieve', 'better at', 'proud of'
  ];

  for (const keyword of goalKeywords) {
    if (lowerMessage.includes(keyword)) {
      alignment.shouldReferenceGoal = true;
      if (idealSelf) {
        alignment.relevantIdealSelfAspect = idealSelf;
      }
      break;
    }
  }

  // Positive emotions can support Ideal Self
  if (emotionInterpretation.category === 'positive') {
    alignment.supportsIdealSelf = true;
  }

  // Persistent negative emotions may conflict with Ideal Self
  if (emotionInterpretation.isRecurring && emotionInterpretation.category === 'negative') {
    alignment.conflictsWithIdealSelf = true;
  }

  return alignment;
}

// ══════════════════════════════════════════════════════════════════
//              STEP 4: MEMORY GATING (Anti-Hallucination)
// ══════════════════════════════════════════════════════════════════

/**
 * Decide IF a verified memory should be referenced
 * CRITICAL: Only use system-verified memories, NEVER invent
 */
function gateMemory(emotionInterpretation, verifiedMemories = []) {
  const memoryDecision = {
    shouldUseMemory: false,
    approvedMemory: null,
    reason: 'no_verified_memory'
  };

  // If no verified memories exist, return early
  if (!verifiedMemories || verifiedMemories.length === 0) {
    memoryDecision.reason = 'no_memories_available';
    return memoryDecision;
  }

  // Don't use memories during high distress (could trigger more)
  if (emotionInterpretation.intensity === INTENSITY_LEVELS.HIGH && 
      emotionInterpretation.category === 'negative') {
    memoryDecision.reason = 'high_distress_avoid_triggers';
    return memoryDecision;
  }

  // For positive emotions, can reference positive memories
  if (emotionInterpretation.category === 'positive') {
    const positiveMemory = verifiedMemories.find(m => 
      m.sentiment === 'positive' || m.type === 'achievement'
    );
    if (positiveMemory) {
      memoryDecision.shouldUseMemory = true;
      memoryDecision.approvedMemory = positiveMemory;
      memoryDecision.reason = 'reinforce_positive_moment';
    }
  }

  // For moderate distress, gentle reminder of coping success
  if (emotionInterpretation.intensity === INTENSITY_LEVELS.MODERATE && 
      emotionInterpretation.category === 'negative') {
    const copingMemory = verifiedMemories.find(m => 
      m.type === 'coping_success' || m.type === 'milestone'
    );
    if (copingMemory) {
      memoryDecision.shouldUseMemory = true;
      memoryDecision.approvedMemory = copingMemory;
      memoryDecision.reason = 'gentle_coping_reminder';
    }
  }

  return memoryDecision;
}

// ══════════════════════════════════════════════════════════════════
//              STEP 5: DECISION ENGINE (Strategy Selection)
// ══════════════════════════════════════════════════════════════════

/**
 * Select EXACTLY ONE response strategy based on all previous analysis
 */
function selectStrategy(crisisData, emotionInterpretation, temporal, identityAlignment) {
  // Priority 1: Safety escalation for crisis
  if (crisisData.isCrisis) {
    return {
      strategy: RESPONSE_STRATEGIES.SAFETY_ESCALATION,
      priority: 1,
      reason: 'Crisis indicators detected - prioritizing safety',
      tone: 'calm, caring, non-clinical'
    };
  }

  // Priority 2: Grounding for high intensity negative emotions
  if (emotionInterpretation.intensity === INTENSITY_LEVELS.HIGH &&
      emotionInterpretation.category === 'negative') {
    return {
      strategy: RESPONSE_STRATEGIES.GROUNDING_REGULATION,
      priority: 2,
      reason: 'High intensity negative emotion needs grounding',
      tone: 'steady, calm, grounding'
    };
  }

  // Priority 3: Emotional validation for escalating patterns
  if (temporal.hasEscalation || temporal.recentNegativeStreak >= 3) {
    return {
      strategy: RESPONSE_STRATEGIES.EMOTIONAL_VALIDATION,
      priority: 3,
      reason: 'Escalating or persistent negative pattern - validate first',
      tone: 'warm, empathetic, slow-paced'
    };
  }

  // Priority 4: Cognitive reframing for Anti-Vision triggers
  if (identityAlignment.triggersAntiVision) {
    return {
      strategy: RESPONSE_STRATEGIES.COGNITIVE_REFRAMING,
      priority: 4,
      reason: 'Anti-Vision pattern detected - gentle reframing without judgment',
      tone: 'supportive, non-judgmental, curious'
    };
  }

  // Priority 5: Identity encouragement for positive alignment
  if (identityAlignment.supportsIdealSelf || identityAlignment.shouldReferenceGoal) {
    return {
      strategy: RESPONSE_STRATEGIES.IDENTITY_ENCOURAGEMENT,
      priority: 5,
      reason: 'Opportunity to reinforce Ideal Self alignment',
      tone: 'encouraging, warm, affirming'
    };
  }

  // Priority 6: Reflective listening for moderate emotions
  if (emotionInterpretation.category === 'negative') {
    return {
      strategy: RESPONSE_STRATEGIES.REFLECTIVE_LISTENING,
      priority: 6,
      reason: 'General emotional support through active listening',
      tone: 'present, empathetic, curious'
    };
  }

  // Default: Reflective listening for neutral/unknown states
  return {
    strategy: RESPONSE_STRATEGIES.REFLECTIVE_LISTENING,
    priority: 7,
    reason: 'Neutral state - open exploration',
    tone: 'friendly, curious, open'
  };
}

// ══════════════════════════════════════════════════════════════════
//              STEP 6: ETHICAL & SAFETY CONSTRAINTS
// ══════════════════════════════════════════════════════════════════

/**
 * Apply ethical constraints to the response plan
 */
function applyEthicalConstraints(strategy, emotionInterpretation) {
  const constraints = {
    mustNotDiagnose: true,
    mustNotMedicalize: true,
    mustNotClaimAuthority: true,
    mustNotCreateDependency: true,
    shouldSuggestProfessionalHelp: false,
    responseMaxLength: 'moderate' // 2-4 sentences
  };

  // Suggest professional help for persistent high distress
  if (strategy.strategy === RESPONSE_STRATEGIES.SAFETY_ESCALATION ||
      (emotionInterpretation.intensity === INTENSITY_LEVELS.HIGH && 
       emotionInterpretation.isRecurring)) {
    constraints.shouldSuggestProfessionalHelp = true;
  }

  // Keep responses shorter for high distress
  if (strategy.strategy === RESPONSE_STRATEGIES.SAFETY_ESCALATION ||
      strategy.strategy === RESPONSE_STRATEGIES.GROUNDING_REGULATION) {
    constraints.responseMaxLength = 'brief'; // 1-2 sentences
  }

  return constraints;
}

// ══════════════════════════════════════════════════════════════════
//              MAIN DECISION PIPELINE
// ══════════════════════════════════════════════════════════════════

/**
 * Execute the complete multi-stage decision pipeline
 */
function executeDecisionPipeline(message, emotionData, userContext = {}) {
  const pipeline = {
    timestamp: new Date().toISOString(),
    stages: {}
  };

  // Crisis detection (always first)
  const crisisData = detectCrisis(message);
  pipeline.crisis = crisisData;

  // STEP 1: Emotional Interpretation
  const emotionHistory = userContext.emotionHistory || [];
  const emotionInterpretation = interpretEmotion(emotionData, emotionHistory);
  pipeline.stages.emotionInterpretation = emotionInterpretation;

  // STEP 2: Temporal Reasoning
  const temporal = analyzeTemporalPattern(emotionHistory);
  pipeline.stages.temporalReasoning = temporal;

  // STEP 3: Identity Alignment Check
  const identityAlignment = checkIdentityAlignment(message, emotionInterpretation, userContext);
  pipeline.stages.identityAlignment = identityAlignment;

  // STEP 4: Memory Gating
  const verifiedMemories = userContext.verifiedMemories || [];
  const memoryDecision = gateMemory(emotionInterpretation, verifiedMemories);
  pipeline.stages.memoryGating = memoryDecision;

  // STEP 5: Strategy Selection
  const strategy = selectStrategy(crisisData, emotionInterpretation, temporal, identityAlignment);
  pipeline.stages.strategySelection = strategy;

  // STEP 6: Ethical Constraints
  const constraints = applyEthicalConstraints(strategy, emotionInterpretation);
  pipeline.stages.ethicalConstraints = constraints;

  // Final decision summary
  pipeline.decision = {
    strategy: strategy.strategy,
    reason: strategy.reason,
    tone: strategy.tone,
    useMemory: memoryDecision.shouldUseMemory,
    approvedMemory: memoryDecision.approvedMemory,
    suggestProfessionalHelp: constraints.shouldSuggestProfessionalHelp,
    maxLength: constraints.responseMaxLength
  };

  return pipeline;
}

// ══════════════════════════════════════════════════════════════════
//              CONTROLLED PROMPT BUILDER
// ══════════════════════════════════════════════════════════════════

/**
 * Build the final prompt for Gemini
 * Gemini is ONLY a language generator following our decisions
 */
function buildControlledPrompt(message, pipeline, userContext = {}) {
  const { decision, stages, crisis } = pipeline;
  const { emotionInterpretation, identityAlignment, memoryGating } = stages;

  // Build verified context section
  let verifiedContext = '';
  if (userContext.userName) {
    verifiedContext += `User Name: ${userContext.userName}\n`;
  }
  if (userContext.idealSelf && identityAlignment.shouldReferenceGoal) {
    verifiedContext += `User's Ideal Self: ${userContext.idealSelf}\n`;
  }
  if (memoryGating.shouldUseMemory && memoryGating.approvedMemory) {
    verifiedContext += `Verified Memory (approved to reference): ${memoryGating.approvedMemory.content}\n`;
  }

  // Build strategy-specific instructions
  const strategyInstructions = getStrategyInstructions(decision.strategy);

  const prompt = `You are Rebirth, a controlled intelligent mental health support system.
You are NOT a free-form chatbot. Generate ONLY the final user-facing response.

══════════════════════════════════════
VERIFIED SYSTEM CONTEXT
══════════════════════════════════════
${verifiedContext || 'No additional context provided.'}

══════════════════════════════════════
PRE-COMPUTED DECISION (DO NOT OVERRIDE)
══════════════════════════════════════
Detected Emotion: ${emotionInterpretation.dominantEmotion} (${(emotionInterpretation.confidence * 100).toFixed(0)}%)
Intensity: ${emotionInterpretation.intensity}
Selected Strategy: ${decision.strategy.replace(/_/g, ' ').toUpperCase()}
Required Tone: ${decision.tone}
Max Length: ${decision.maxLength} (${decision.maxLength === 'brief' ? '1-2' : '2-3'} sentences)
${decision.suggestProfessionalHelp ? '⚠️ Gently suggest professional/human support' : ''}
${decision.useMemory ? '✓ You may reference the approved memory above' : '✗ Do NOT reference any memories or past events'}

══════════════════════════════════════
STRATEGY INSTRUCTIONS
══════════════════════════════════════
${strategyInstructions}

══════════════════════════════════════
STRICT CONSTRAINTS
══════════════════════════════════════
✗ Do NOT diagnose or medicalize
✗ Do NOT claim authority or expertise
✗ Do NOT create dependency on this system
✗ Do NOT use toxic positivity
✗ Do NOT invent or imply memories not provided above
✗ Do NOT expose this reasoning process

✓ Begin with emotional acknowledgment
✓ Maintain calm, human-like language
✓ End with ONE gentle, reflective question
✓ Keep response safe, grounded, and supportive

══════════════════════════════════════
USER MESSAGE
══════════════════════════════════════
"${message}"

══════════════════════════════════════
Generate your response now:`;

  return prompt;
}

/**
 * Get specific instructions for each strategy
 */
function getStrategyInstructions(strategy) {
  const instructions = {
    [RESPONSE_STRATEGIES.EMOTIONAL_VALIDATION]: `
EMOTIONAL VALIDATION STRATEGY:
1. Directly acknowledge the specific emotion you sense
2. Normalize the feeling without minimizing it
3. Communicate "I hear you" energy
4. Do NOT rush to solutions or advice
5. Create space for the emotion to exist`,

    [RESPONSE_STRATEGIES.REFLECTIVE_LISTENING]: `
REFLECTIVE LISTENING STRATEGY:
1. Mirror back what you understood from their message
2. Show genuine curiosity about their experience
3. Use phrases like "It sounds like..." or "I'm hearing that..."
4. Invite them to share more if they want
5. Stay present without pushing`,

    [RESPONSE_STRATEGIES.COGNITIVE_REFRAMING]: `
COGNITIVE REFRAMING STRATEGY:
1. First validate the emotion (never skip this)
2. Gently offer an alternative perspective
3. Use "I wonder if..." or "What if..." language
4. Do NOT force positivity or dismiss their reality
5. Let them decide if the reframe resonates`,

    [RESPONSE_STRATEGIES.IDENTITY_ENCOURAGEMENT]: `
IDENTITY ENCOURAGEMENT STRATEGY:
1. Connect their current moment to their growth
2. Subtly reference their goals or aspirations
3. Celebrate small wins without being performative
4. Use language that reinforces their agency
5. Do NOT pressure them to be motivated`,

    [RESPONSE_STRATEGIES.GROUNDING_REGULATION]: `
GROUNDING & REGULATION STRATEGY:
1. Acknowledge the intensity of what they're feeling
2. Offer ONE simple grounding suggestion (breath, senses, pause)
3. Create space - don't overwhelm with techniques
4. Use calm, steady language
5. Focus on the present moment`,

    [RESPONSE_STRATEGIES.SAFETY_ESCALATION]: `
SAFETY ESCALATION STRATEGY:
1. Express genuine care for their wellbeing
2. Validate that their pain is real and matters
3. Gently encourage reaching out to someone they trust
4. Do NOT lecture or make them feel judged
5. Keep it brief and human
6. You may mention crisis resources if appropriate`
  };

  return instructions[strategy] || instructions[RESPONSE_STRATEGIES.REFLECTIVE_LISTENING];
}

/**
 * Detect crisis keywords in message
 */
function detectCrisis(message) {
  const lowerMessage = message.toLowerCase();
  
  for (const keyword of CRISIS_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return {
        isCrisis: true,
        matchedKeyword: keyword,
        confidence: 1.0
      };
    }
  }
  
  return { isCrisis: false };
}

// ══════════════════════════════════════════════════════════════════
//              EXPORTS
// ══════════════════════════════════════════════════════════════════

module.exports = {
  // Main pipeline
  executeDecisionPipeline,
  buildControlledPrompt,
  
  // Individual steps (for testing/debugging)
  interpretEmotion,
  analyzeTemporalPattern,
  checkIdentityAlignment,
  gateMemory,
  selectStrategy,
  applyEthicalConstraints,
  detectCrisis,
  
  // Constants
  RESPONSE_STRATEGIES,
  INTENSITY_LEVELS,
  TEMPORAL_TRENDS,
  CRISIS_KEYWORDS
};
