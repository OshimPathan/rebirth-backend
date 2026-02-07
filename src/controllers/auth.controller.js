const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const path = require('path');
const fs = require('fs');

// Register new user
exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create new user
    const user = new User({
      email,
      password,
      name
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Error registering user' });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Error logging in' });
  }
};

// Get current user
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ message: 'Error getting user data' });
  }
}; 

// Update profile (name, profilePicture URL)
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, profilePicture } = req.body || {};

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (typeof name === 'string' && name.trim()) user.name = name.trim();
    if (typeof profilePicture === 'string') user.profilePicture = profilePicture.trim();

    await user.save();
    res.json({ message: 'Profile updated', user: { id: user._id, email: user.email, name: user.name, profilePicture: user.profilePicture, onboarding: user.onboarding, goals: user.goals, aiInsights: user.aiInsights } });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Error updating profile' });
  }
};

// Goals
exports.listGoals = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('goals');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ goals: user.goals || [] });
  } catch (error) {
    console.error('List goals error:', error);
    res.status(500).json({ message: 'Error listing goals' });
  }
};

exports.createGoal = async (req, res) => {
  try {
    const { title, category, targetDate } = req.body || {};
    if (!title || !category) return res.status(400).json({ message: 'title and category are required' });
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const goal = { title: title.trim(), category, status: 'active' };
    if (targetDate) goal.targetDate = new Date(targetDate);
    user.goals.push(goal);
    await user.save();
    res.status(201).json({ goal: user.goals[user.goals.length - 1] });
  } catch (error) {
    console.error('Create goal error:', error);
    res.status(500).json({ message: 'Error creating goal' });
  }
};

exports.updateGoal = async (req, res) => {
  try {
    const { goalId } = req.params;
    const updates = req.body || {};
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const goal = user.goals.id(goalId);
    if (!goal) return res.status(404).json({ message: 'Goal not found' });
    Object.assign(goal, updates);
    await user.save();
    res.json({ goal });
  } catch (error) {
    console.error('Update goal error:', error);
    res.status(500).json({ message: 'Error updating goal' });
  }
};

exports.deleteGoal = async (req, res) => {
  try {
    const { goalId } = req.params;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const goal = user.goals.id(goalId);
    if (!goal) return res.status(404).json({ message: 'Goal not found' });
    goal.remove();
    await user.save();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete goal error:', error);
    res.status(500).json({ message: 'Error deleting goal' });
  }
};