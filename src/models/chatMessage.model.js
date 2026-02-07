const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatSession', index: true, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
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
  },
  { timestamps: true }
);

chatMessageSchema.index({ session: 1, createdAt: 1 });
chatMessageSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.ChatMessage || mongoose.model('ChatMessage', chatMessageSchema);


