const mongoose = require('mongoose');

// Emotion data schema for BERT-based emotion detection
const emotionDataSchema = new mongoose.Schema(
  {
    emotion: { type: String, required: true }, // primary emotion detected
    confidence: { type: Number, required: true, min: 0, max: 1 },
    category: { type: String, enum: ['positive', 'negative', 'neutral'] },
    severity: { type: String, enum: ['none', 'low', 'moderate', 'high'] },
    color: { type: String },
    allEmotions: [
      new mongoose.Schema(
        {
          emotion: { type: String },
          confidence: { type: Number },
          category: { type: String },
          severity: { type: String },
          color: { type: String }
        },
        { _id: false }
      )
    ],
    modelUsed: { type: String },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const messageSubSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    text: { type: String, required: true, trim: true },
    spans: [
      new mongoose.Schema(
        {
          text: { type: String, required: true },
          bold: { type: Boolean, default: false },
        },
        { _id: false }
      ),
    ],
    tokens: { type: Number },
    responseTimeMs: { type: Number },
    emotionData: emotionDataSchema, // BERT emotion detection result
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const chatMessageBucketSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatSession', index: true, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    bucketIndex: { type: Number, required: true },
    messages: { type: [messageSubSchema], default: [] },
    count: { type: Number, default: 0 },
  },
  { timestamps: true }
);

chatMessageBucketSchema.index({ session: 1, bucketIndex: 1 }, { unique: true });
chatMessageBucketSchema.index({ user: 1, session: 1 });

module.exports =
  mongoose.models.ChatMessageBucket ||
  mongoose.model('ChatMessageBucket', chatMessageBucketSchema);


