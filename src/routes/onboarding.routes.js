const express = require('express');
const router = express.Router();
const onboardingController = require('../controllers/onboarding.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Get onboarding status
router.get('/status', authMiddleware, onboardingController.getOnboardingStatus);

// Update onboarding data
router.patch('/update', authMiddleware, onboardingController.updateOnboarding);

// Complete onboarding
router.post('/complete', authMiddleware, onboardingController.completeOnboarding);

// Generate AI summary on the backend
router.post('/generate-summary', authMiddleware, onboardingController.generateSummary);

module.exports = router; 