const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Register new user
router.post('/register', authController.register);

// Login user
router.post('/login', authController.login);

// Get current user (protected route)
router.get('/me', authMiddleware, authController.getCurrentUser);

// Update profile (name, profile picture)
router.patch('/profile', authMiddleware, authController.updateProfile);

// Goals CRUD
router.get('/goals', authMiddleware, authController.listGoals);
router.post('/goals', authMiddleware, authController.createGoal);
router.patch('/goals/:goalId', authMiddleware, authController.updateGoal);
router.delete('/goals/:goalId', authMiddleware, authController.deleteGoal);

module.exports = router; 