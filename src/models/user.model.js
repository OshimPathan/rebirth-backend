const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Schema for individual check-ins
const checkInSchema = new mongoose.Schema({
  date: {
    type: Date,
    default: Date.now,
    required: true
  },
  emotion: {
    type: String,
    required: true,
    trim: true
  },
  emotionIntensity: {
    type: Number,
    min: 1,
    max: 10,
    required: true
  },
  notes: {
    type: String,
    trim: true
  },
  activities: [{
    type: String,
    trim: true
  }],
  sleepHours: {
    type: Number,
    min: 0,
    max: 24
  },
  energyLevel: {
    type: Number,
    min: 1,
    max: 10
  }
}, {
  timestamps: true
});

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  profilePicture: {
    type: String,
    default: ''
  },
  // Onboarding data
  onboarding: {
    isCompleted: {
      type: Boolean,
      default: false
    },
    personalInfo: {
      age: {
        type: Number,
        min: 13,
        max: 120
      },
      gender: {
        type: String,
        enum: ['male', 'female', 'non-binary', 'prefer_not_to_say', 'other']
      },
      occupation: {
        type: String,
        trim: true
      },
      location: {
        type: String,
        trim: true
      }
    },
    transformation: {
      thingsToRemove: [{
        type: String,
        trim: true
      }],
      idealSelfDescription: {
        type: String,
        trim: true
      },
      qualitiesToBuild: [{
        type: String,
        trim: true
      }],
      negativeHabits: [{
        type: String,
        trim: true
      }],
      thingsToAvoid: [{
        type: String,
        trim: true
      }],
      motivations: [{
        type: String,
        trim: true
      }],
      currentChallenges: [{
        type: String,
        trim: true
      }]
    },
    completedAt: {
      type: Date
    }
  },
  goals: [{
    title: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      enum: ['mental_health', 'personal_growth', 'relationships', 'career', 'other'],
      required: true
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'paused'],
      default: 'active'
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    targetDate: Date,
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    }
  }],
  checkinHistory: [checkInSchema],
  aiInsights: [{
    insight: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      enum: ['behavior_pattern', 'emotional_trigger', 'coping_strategy', 'progress', 'recommendation'],
      required: true
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      required: true
    },
    dateIdentified: {
      type: Date,
      default: Date.now
    },
    relatedCheckins: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Checkin'
    }]
  }],
  preferences: {
    checkInReminders: {
      enabled: {
        type: Boolean,
        default: true
      },
      frequency: {
        type: String,
        enum: ['daily', 'weekly', 'custom'],
        default: 'daily'
      },
      preferredTime: String
    },
    notifications: {
      type: Boolean,
      default: true
    },
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system'
    }
  },
  lastLogin: {
    type: Date
  },
  streakCount: {
    type: Number,
    default: 0
  },
  lastCheckIn: {
    type: Date
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Method to update streak count
userSchema.methods.updateStreak = function() {
  const now = new Date();
  const lastCheckIn = this.lastCheckIn;
  
  if (!lastCheckIn) {
    this.streakCount = 1;
  } else {
    const daysSinceLastCheckIn = Math.floor((now - lastCheckIn) / (1000 * 60 * 60 * 24));
    
    if (daysSinceLastCheckIn <= 1) {
      this.streakCount += 1;
    } else {
      this.streakCount = 1;
    }
  }
  
  this.lastCheckIn = now;
};

const User = mongoose.model('User', userSchema);

module.exports = User; 