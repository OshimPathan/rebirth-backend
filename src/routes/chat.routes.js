const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Chat sessions
router.post('/sessions', authMiddleware, chatController.createSession);
router.get('/sessions', authMiddleware, chatController.listSessions);
router.get('/sessions/:sessionId/messages', authMiddleware, chatController.getSessionMessages);
router.get('/sessions/today', authMiddleware, chatController.getOrCreateTodaySession);
router.patch('/sessions/:sessionId', authMiddleware, chatController.updateSession);

// Send a chat message to AI and receive formatted response
router.post('/message', authMiddleware, chatController.sendMessage);

// Analytics and progress tracking
router.get('/analytics/emotions', authMiddleware, chatController.getEmotionAnalytics);
router.get('/analytics/progress', authMiddleware, chatController.getProgressTracking);
router.get('/analytics/mental-health-summary', authMiddleware, chatController.getMentalHealthSummary);

// Goals management
router.post('/goals', authMiddleware, chatController.createGoal);
router.put('/goals/:goalId', authMiddleware, chatController.updateGoal);
router.delete('/goals/:goalId', authMiddleware, chatController.deleteGoal);
router.patch('/goals/:goalId/progress', authMiddleware, chatController.updateGoalProgress);

module.exports = router;


