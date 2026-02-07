const User = require('../models/user.model');
const axios = require('axios');

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
  if (spans.length === 0) return [{ text, bold: false }];
  return spans;
}

function buildOnboardingPrompt(data) {
  const lines = [];
  lines.push("You are a personal development coach. Analyze the user's onboarding data and provide a comprehensive personality summary with actionable insights in about 100 to 150 words.");
  lines.push('');
  lines.push('User Data:');

  const personalInfo = data?.personalInfo || {};
  const transformation = data?.transformation || {};

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

  lines.push('');
  lines.push('Please provide:');
  lines.push('1. A personality analysis based on their goals and self-description');
  lines.push('2. Actionable steps they can take to achieve their ideal self');
  lines.push('3. Strategies to overcome their negative habits');
  lines.push('4. A personalized development plan');
  return lines.join('\n');
}

exports.generateSummary = async (req, res) => {
  try {
    const userId = req.user.userId;
    let onboarding = req.body?.onboardingData;

    if (!onboarding) {
      const user = await User.findById(userId).select('onboarding');
      if (!user) return res.status(404).json({ message: 'User not found' });
      onboarding = user.onboarding;
    }

    const prompt = buildOnboardingPrompt(onboarding);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ message: 'Missing GEMINI_API_KEY in server environment' });
    }

    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
    const url = `${endpoint}?key=${apiKey}`;
    const body = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ]
    };

    let data;
    try {
      const aiRes = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
      data = aiRes.data;
    } catch (err) {
      const status = err.response?.status || 500;
      const details = err.response?.data || err.message;
      return res.status(502).json({ message: 'AI provider error', status, details });
    }

    let text = 'No summary available';
    try {
      text = data?.candidates?.[0]?.content?.parts?.[0]?.text || text;
    } catch (_) {}

    return res.json({ text, spans: formatTextToSpans(text) });
  } catch (error) {
    console.error('Generate summary error:', error);
    res.status(500).json({ message: 'Error generating summary' });
  }
};

// Update onboarding data
exports.updateOnboarding = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { personalInfo, transformation } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update onboarding data
    if (personalInfo) {
      user.onboarding.personalInfo = { ...user.onboarding.personalInfo, ...personalInfo };
    }

    if (transformation) {
      user.onboarding.transformation = { ...user.onboarding.transformation, ...transformation };
    }

    await user.save();

    res.json({
      message: 'Onboarding data updated successfully',
      onboarding: user.onboarding
    });
  } catch (error) {
    console.error('Update onboarding error:', error);
    res.status(500).json({ message: 'Error updating onboarding data' });
  }
};

// Complete onboarding
exports.completeOnboarding = async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Mark onboarding as completed
    user.onboarding.isCompleted = true;
    user.onboarding.completedAt = new Date();

    await user.save();

    res.json({
      message: 'Onboarding completed successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        onboarding: user.onboarding
      }
    });
  } catch (error) {
    console.error('Complete onboarding error:', error);
    res.status(500).json({ message: 'Error completing onboarding' });
  }
};

// Get onboarding status
exports.getOnboardingStatus = async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId).select('onboarding');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      onboarding: user.onboarding
    });
  } catch (error) {
    console.error('Get onboarding status error:', error);
    res.status(500).json({ message: 'Error getting onboarding status' });
  }
}; 