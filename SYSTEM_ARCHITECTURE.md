# Rebirth Backend - System Architecture

## 1. Overview

**Rebirth** is a personal transformation and mental wellness platform with AI-powered chat capabilities. The backend is a Node.js/Express REST API optimized for serverless deployment (Vercel), integrated with MongoDB for data persistence, **BERT-based emotion detection via Hugging Face**, and **Google Gemini AI** for intelligent, emotionally-aware conversations.

### Key Characteristics:
- **Type**: REST API Backend
- **Framework**: Express.js
- **Database**: MongoDB
- **Emotion Detection**: BERT model via Hugging Face Inference API
- **Response Generation**: Google Gemini API (emotion-aware prompts)
- **Deployment**: Serverless (Vercel-optimized)
- **Architecture Pattern**: Layered (Controllers → Services → Models)

### Environment Variables Required:
```
MONGODB_URI=<your-mongodb-connection-string>
JWT_SECRET=<your-jwt-secret>
GEMINI_API_KEY=<your-google-gemini-api-key>
HUGGINGFACE_API_KEY=<your-huggingface-api-key> (optional, uses rule-based fallback if not set)
```

---

## 2. High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
│                   (Mobile/Web Frontend)                          │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS REST API
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXPRESS.JS API GATEWAY                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Rate Limiting │ CORS │ Helmet │ Compression │ Logging   │  │
│  │                                                           │  │
│  │  Health Check: GET /                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────┬───────────────┬──────────────────┬──────────────────┘
           │               │                  │
           ▼               ▼                  ▼
    ┌────────────┐  ┌────────────┐   ┌──────────────┐
    │   AUTH     │  │  CHAT      │   │ ONBOARDING   │
    │  ROUTES    │  │  ROUTES    │   │   ROUTES     │
    └────────────┘  └────────────┘   └──────────────┘
           │               │                  │
           ▼               ▼                  ▼
    ┌────────────┐  ┌────────────┐   ┌──────────────┐
    │   AUTH     │  │   CHAT     │   │ ONBOARDING   │
    │CONTROLLER  │  │ CONTROLLER │   │ CONTROLLER   │
    └────────────┘  └────────────┘   └──────────────┘
           │               │                  │
           ▼               ▼                  ▼
       ┌────────────────────────────────────────────┐
       │         SERVICES LAYER                     │
       │  ┌──────────────────────────────────────┐ │
       │  │  Emotion Service (BERT Detection)    │ │
       │  │  - Hugging Face Inference API        │ │
       │  │  - Rule-based fallback               │ │
       │  └──────────────────────────────────────┘ │
       └────────────────────────────────────────────┘
           │               │
           ▼               ▼
       ┌────────────────────────────────────────────┐
       │         MIDDLEWARE LAYER                   │
       │  ┌──────────────────────────────────────┐ │
       │  │  Auth Middleware (JWT Verification)  │ │
       │  │  DB Connection Middleware            │ │
       │  └──────────────────────────────────────┘ │
       └────────────────────────────────────────────┘
           │
           ▼
       ┌────────────────────────────────────────────┐
       │         DATA LAYER (MODELS)                │
       │  ┌──────────────────────────────────────┐ │
       │  │ User │ ChatSession │ ChatMessage │   │ │
       │  │      │ ChatMessageBucket (+ emotion) │ │
       │  └──────────────────────────────────────┘ │
       └────────────────────────────────────────────┘
           │                    │
           ▼                    ▼
    ┌────────────┐      ┌──────────────────┐      ┌─────────────────┐
    │  MONGODB   │      │  GEMINI AI API   │      │  HUGGING FACE   │
    │  (Primary) │      │  (Response Gen)  │      │  (Emotion API)  │
    └────────────┘      └──────────────────┘      └─────────────────┘
```

---

## 3. Emotion Detection Flow

```
User Message
      │
      ▼
┌─────────────────────────────────────┐
│   BERT Emotion Detection            │
│   (Hugging Face Inference API)      │
│   Model: bhadresh-savani/bert-base  │
│   -uncased-emotion                  │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│   Emotion Result                     │
│   - Primary: joy, sadness, anger,   │
│     fear, love, surprise            │
│   - Confidence: 0.0 - 1.0           │
│   - Category: positive/negative/    │
│     neutral                         │
│   - Response Strategy               │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│   Emotion-Aware Prompt Builder      │
│   - Injects emotion context         │
│   - Applies response strategy       │
│   - Guides Gemini tone/approach     │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│   Google Gemini API                  │
│   - Generates empathetic response   │
│   - Context-aware conversation      │
└─────────────────────────────────────┘
```

---

## 4. Component Architecture

### 4.1 Request Flow

```
Client Request
      │
      ▼
   Express Middleware Stack
   ├─ JSON/URL Parser
   ├─ CORS Handler
   ├─ Helmet (Security Headers)
   ├─ Compression
   ├─ Morgan (Logging)
   ├─ Rate Limiter
   └─ DB Connection Middleware
      │
      ▼
   Route Handlers
   ├─ Auth Routes (/auth/*)
   ├─ Chat Routes (/chat/*)
   │   ├─ POST /message (with emotion detection)
   │   ├─ GET /analytics/emotions
   │   └─ GET /analytics/progress
   └─ Onboarding Routes (/onboarding/*)
      │
      ▼
   Controllers
   └─ Business Logic
      │
      ▼
   Models (MongoDB)
   └─ Data Persistence
      │
      ▼
   Response to Client
```

---

## 4. Module Breakdown

### 4.1 **Entry Point** (`src/index.js`)
**Responsibility**: Server initialization and middleware setup

**Key Responsibilities**:
- Initialize Express app
- Configure global middleware (CORS, Helmet, Compression, Rate Limiting)
- Establish MongoDB connection (with serverless optimization)
- Implement health check endpoint
- Mount route handlers
- Handle graceful error responses

**Database Connection Strategy**:
- Uses connection pooling optimized for serverless
- Single connection pool (maxPoolSize: 1) for Vercel Functions
- Connection caching to prevent reconnection overhead
- Automatic disconnection after 30 seconds of inactivity

---

### 4.2 **Models Layer** (`src/models/`)

#### **User Model** (`user.model.js`)
**Stores**: User profile, authentication, onboarding data, goals, and wellness check-ins

**Schema Structure**:
```
User
├─ Authentication
│  ├─ email (unique, indexed)
│  ├─ password (hashed with bcrypt)
│  └─ name
├─ Profile
│  ├─ profilePicture
│  └─ lastLoginAt
├─ Onboarding
│  ├─ isCompleted (boolean flag)
│  ├─ personalInfo (age, gender, occupation, location)
│  └─ transformation (idealSelfDescription, qualitiesToBuild, negativeHabits)
├─ Goals (array)
│  ├─ title
│  ├─ description
│  ├─ category
│  └─ status
└─ Check-ins (embedded array)
   ├─ date
   ├─ emotion
   ├─ emotionIntensity (1-10)
   ├─ activities
   ├─ sleepHours
   └─ energyLevel
```

#### **Chat Session Model** (`chatSession.model.js`)
**Stores**: Chat conversation sessions

**Schema Structure**:
```
ChatSession
├─ user (ref: User, indexed)
├─ title
├─ model (AI model version)
├─ messagesCount
├─ lastMessageAt
├─ archived
└─ timestamps (createdAt, updatedAt)
```

**Indexes**:
- `{ user: 1, updatedAt: -1 }` - Retrieve sessions by user, sorted by recency
- `{ user: 1, lastMessageAt: -1 }` - Find sessions by last message

#### **Chat Message Models**
**Two patterns for message storage**:

1. **ChatMessage Model** (`chatMessage.model.js`)
   - Individual message documents
   - Use case: Small conversations, easier querying

2. **ChatMessageBucket Model** (`chatMessageBucket.model.js`)
   - **Optimized for large conversations**
   - Groups multiple messages into buckets (array-based storage)
   - Reduces document count for sessions with many messages
   - Better for pagination and performance

**Bucket Schema Structure**:
```
ChatMessageBucket
├─ session (ref: ChatSession)
├─ user (ref: User)
├─ bucketIndex (ordinal position)
└─ messages (array)
   ├─ role ('user' or 'assistant')
   ├─ text (message content)
   ├─ spans (formatting: { text, bold })
   └─ createdAt
```

---

### 4.3 **Middleware Layer** (`src/middleware/`)

#### **Auth Middleware** (`auth.middleware.js`)
**Responsibility**: Protect routes and extract user context

**Flow**:
1. Extract Bearer token from Authorization header
2. Verify JWT signature using `JWT_SECRET`
3. Decode token to extract `userId`
4. Attach user object to `req.user`
5. Pass control to next middleware/controller

**Error Handling**: Returns 401 if token missing or invalid

---

### 4.4 **Controllers Layer** (`src/controllers/`)

#### **Auth Controller** (`auth.controller.js`)
**Endpoints**:
- `POST /auth/register` - Create new user account
- `POST /auth/login` - Authenticate and receive JWT
- `GET /auth/me` - Get current user profile (protected)
- `PATCH /auth/profile` - Update user profile (protected)
- `GET/POST/PATCH/DELETE /auth/goals` - Goal CRUD operations (protected)

**Key Functions**:
- Password hashing with bcrypt
- JWT token generation
- Input validation and sanitization

#### **Chat Controller** (`chat.controller.js`)
**Endpoints**:
- `POST /chat/sessions` - Create new chat session
- `GET /chat/sessions` - List all user sessions
- `GET /chat/sessions/:sessionId/messages` - Retrieve session messages
- `GET /chat/sessions/today` - Get or create today's session
- `PATCH /chat/sessions/:sessionId` - Update session (e.g., archive)
- `POST /chat/message` - Send message to AI and receive response

**Core Logic**:

**User Context Building**:
- Extracts onboarding data, goals, and preferences
- Prepends context to AI prompts for personalized responses
- Example fields: name, goals, ideal self description, qualities to build

**Message Formatting**:
- Converts markdown bold (`**text**`) to span objects for client rendering
- `{ text: string, bold: boolean }`

**AI Integration**:
- Calls Gemini API with user context
- Streams or fetches structured responses
- Stores messages in ChatMessageBucket for efficiency

**Session Management**:
- UTC-based "today" logic for daily session retrieval
- Efficient cursor-based message collection
- Pagination support with limits

#### **Onboarding Controller** (`onboarding.controller.js`)
**Responsibility**: Handle user transformation setup during onboarding

**Typical Endpoints**:
- `POST /onboarding/start`
- `PATCH /onboarding/personal-info`
- `PATCH /onboarding/transformation`
- `GET /onboarding/status`

---

### 4.5 **Routes Layer** (`src/routes/`)

Each route file defines HTTP endpoints and maps them to controllers:

```
routes/
├─ auth.routes.js (Mount at /auth)
├─ chat.routes.js (Mount at /chat)
└─ onboarding.routes.js (Mount at /onboarding)
```

---

## 5. Data Flow Examples

### 5.1 User Registration Flow
```
POST /auth/register
  ↓
authController.register()
  ├─ Validate email format & password strength
  ├─ Hash password with bcrypt
  ├─ Create User document
  ├─ Generate JWT token
  └─ Return { user, token }
```

### 5.2 Send Chat Message Flow
```
POST /chat/message
  ↓
authMiddleware (verify JWT)
  ↓
chatController.sendMessage()
  ├─ Extract sessionId from request
  ├─ Fetch User document (with goals, onboarding data)
  ├─ Build user context string
  ├─ Fetch recent messages (from ChatMessageBucket)
  ├─ Call Gemini API with context + messages + new message
  ├─ Format AI response (spans formatting)
  ├─ Save user + assistant messages to ChatMessageBucket
  ├─ Update ChatSession.messagesCount & lastMessageAt
  └─ Return { messages: [...], sessionUpdated: {...} }
```

### 5.3 Get Today's Session Flow
```
GET /chat/sessions/today
  ↓
authMiddleware
  ↓
chatController.getOrCreateTodaySession()
  ├─ Calculate UTC today range (00:00 - 23:59)
  ├─ Query ChatSession where createdAt is within range
  ├─ If not exists: Create new session
  ├─ Fetch recent messages using cursor + reverse sort
  ├─ Collect & paginate up to limit (default 100)
  └─ Return { session, messages: [...] }
```

---

## 6. Database Indexing Strategy

### Indexes for Performance:
```
User Collection:
  ├─ email (unique) - Fast user lookup by email
  └─ createdAt (implicit) - Sort by signup date

ChatSession Collection:
  ├─ user (index) - Filter sessions by user
  ├─ { user: 1, updatedAt: -1 } - List sessions by user, sorted by recency
  └─ { user: 1, lastMessageAt: -1 } - Find active sessions

ChatMessageBucket Collection:
  ├─ { session, user } - Retrieve buckets for a session
  └─ { session, user, bucketIndex } - Ordered message retrieval
```

---

## 7. Security Architecture

### 7.1 Authentication
- **Method**: JWT (JSON Web Tokens)
- **Secret**: Stored in `process.env.JWT_SECRET`
- **Token Structure**: `{ userId, iat, exp }`
- **Delivery**: Bearer token in Authorization header

### 7.2 Password Security
- **Algorithm**: bcrypt
- **Rounds**: Default (10) - balance between security and performance
- **Storage**: Hashed password only, never plain text

### 7.3 HTTP Security Headers
- **Helmet**: Adds security headers (X-Frame-Options, X-Content-Type-Options, etc.)
- **CORS**: Configurable origin whitelist
- **Rate Limiting**: 100 requests per IP per 15 minutes (protects against brute force)

### 7.4 Protected Routes
All routes except `/auth/register`, `/auth/login`, and health check (`/`) require:
- Valid JWT token in Authorization header
- Token verification by `authMiddleware`

---

## 8. External Integrations

### 8.1 Google Gemini API
**Purpose**: AI-powered conversational chat

**Integration Details**:
- **Endpoint**: `process.env.GEMINI_API_KEY`
- **Request Format**: Passes user context + message history + new message
- **Response**: Structured text response with formatting
- **Usage**: 
  - Personalized wellness coaching
  - Goal tracking assistance
  - Emotional support conversations

**Error Handling**: Graceful fallback if API fails

---

## 9. Deployment & Scalability

### 9.1 Serverless Optimization (Vercel)
- **Connection Pooling**: Single connection in serverless functions
- **Connection Timeout**: 5 seconds (instead of default 30)
- **Max Idle Time**: 30 seconds - connections auto-disconnect
- **Buffer Commands**: Disabled - prevents memory waste in serverless
- **IPv4 Only**: Avoids IPv6 resolution delays

### 9.2 Caching Strategy
- **Database Connection Caching**: Reuses connection across function invocations
- **Message Cursor**: Efficient pagination using MongoDB cursors
- **Bucket-based Storage**: Reduces document count for large conversations

### 9.3 Rate Limiting
- **Global Rate Limit**: 100 requests per IP per 15 minutes
- **Purpose**: Prevent DDoS, brute force attacks, API abuse

---

## 10. Environment Variables Required

```bash
# Database
MONGODB_URI=mongodb+srv://...

# Authentication
JWT_SECRET=your-secret-key

# AI Integration
GEMINI_API_KEY=your-gemini-key

# Deployment
NODE_ENV=production
PORT=8000

# CORS (optional)
CLIENT_URL=https://yourfrontend.com
```

---

## 11. Error Handling Strategy

### 11.1 Error Responses
All endpoints return consistent error format:
```json
{
  "message": "Error description",
  "error": "Detailed error message (development only)"
}
```

### 11.2 HTTP Status Codes
- `200 OK` - Successful request
- `201 Created` - Resource created
- `400 Bad Request` - Invalid input
- `401 Unauthorized` - Missing/invalid token
- `404 Not Found` - Resource doesn't exist
- `500 Internal Server Error` - Server error

---

## 12. Future Architecture Enhancements

### Potential Improvements:
1. **Service Layer**: Extract business logic from controllers into dedicated services
2. **Caching Layer**: Redis for session caching, rate limit tracking
3. **Message Queue**: Bull/RabbitMQ for async operations (AI processing)
4. **Analytics**: Log user interactions for insights
5. **Logging**: Winston/Pino for structured logging
6. **API Versioning**: Support multiple API versions (`/v1/`, `/v2/`)
7. **GraphQL**: Consider GraphQL for flexible data queries
8. **Webhook Support**: Notify external systems of events (check-in, goal completion)
9. **WebSocket**: Real-time chat without polling
10. **Database Sharding**: Distribute data by user ID as user base grows

---

## 13. Technology Stack Summary

| Layer | Technology |
|-------|------------|
| **Framework** | Express.js v4.18.2 |
| **Database** | MongoDB v7.0.3 |
| **Auth** | JWT with jsonwebtoken v9.0.0 |
| **Password** | bcrypt v5.1.1 |
| **Security** | Helmet v7.0.0 |
| **Compression** | compression v1.7.4 |
| **Logging** | morgan v1.10.0 |
| **Rate Limit** | express-rate-limit v6.7.0 |
| **CORS** | cors v2.8.5 |
| **HTTP Client** | axios v1.11.0 |
| **Dev Tool** | nodemon v3.1.10 |
| **External API** | Google Gemini |
| **Deployment** | Vercel (Serverless) |

---

## 14. File Structure Reference

```
src/
├─ index.js                          # Server entry point
├─ controllers/
│  ├─ auth.controller.js            # Auth logic
│  ├─ chat.controller.js            # Chat logic
│  └─ onboarding.controller.js      # Onboarding logic
├─ middleware/
│  └─ auth.middleware.js            # JWT verification
├─ models/
│  ├─ user.model.js                 # User schema
│  ├─ chatSession.model.js          # Chat session schema
│  ├─ chatMessage.model.js          # Individual message schema
│  └─ chatMessageBucket.model.js    # Bucketed message schema
└─ routes/
   ├─ auth.routes.js                # Auth endpoints
   ├─ chat.routes.js                # Chat endpoints
   └─ onboarding.routes.js          # Onboarding endpoints
```

---

**Last Updated**: January 31, 2026
**Status**: Production Ready
**Version**: 1.0.0
