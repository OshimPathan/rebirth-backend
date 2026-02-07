const mongoose = require('mongoose');

const chatSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    title: { type: String, trim: true, default: 'New Chat' },
    model: { type: String, trim: true, default: 'gemini-2.0-flash' },
    messagesCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

chatSessionSchema.index({ user: 1, updatedAt: -1 });
chatSessionSchema.index({ user: 1, lastMessageAt: -1 });

module.exports = mongoose.models.ChatSession || mongoose.model('ChatSession', chatSessionSchema);


