import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// 1. CONFIGURATION & STARTUP VALIDATION
// ==========================================
export const PORT = parseInt(process.env.PORT || '5000', 10);
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
export const JWT_SECRET = process.env.JWT_SECRET || 'campus_smart_resource_booking_jwt_secret_dev_key_2026_xyz!';

if (NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  console.error('[CRITICAL SECURITY ERROR] In production, JWT_SECRET must be at least 32 characters long!');
  process.exit(1);
}

export const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smart_campus_booking';

// Keep track of Mongo memory server instance if used as fallback
let mongoMemoryServerInstance = null;

export async function connectDatabase(customUri = null) {
  const targetUri = customUri || process.env.TEST_MONGODB_URI || MONGODB_URI;

  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(targetUri, {
      serverSelectionTimeoutMS: 2500,
    });
    console.log(`[MongoDB] Connected to database: ${mongoose.connection.host}/${mongoose.connection.name}`);
    return mongoose.connection;
  } catch (err) {
    if (NODE_ENV !== 'production' && !customUri && !process.env.TEST_MONGODB_URI) {
      console.warn(`[MongoDB] Could not connect to local daemon (${err.message}). Initializing isolated MongoMemoryServer for development...`);
      try {
        const { MongoMemoryServer } = await import('mongodb-memory-server');
        mongoMemoryServerInstance = await MongoMemoryServer.create();
        const memUri = mongoMemoryServerInstance.getUri();
        await mongoose.connect(memUri);
        console.log(`[MongoDB] Connected to in-memory database at: ${memUri}`);
        // Auto-seed in-memory instance for smooth developer experience
        await seedDatabase(false);
        return mongoose.connection;
      } catch (memErr) {
        console.error(`[MongoDB] In-memory server fallback failed: ${memErr.message}`);
        throw err;
      }
    }
    throw err;
  }
}

export async function disconnectDatabase() {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoMemoryServerInstance) {
      await mongoMemoryServerInstance.stop();
      mongoMemoryServerInstance = null;
    }
  } catch (err) {
    console.error(`[MongoDB] Error during disconnect: ${err.message}`);
  }
}

// ==========================================
// 2. MONGOOSE SCHEMAS & MODELS
// ==========================================

// --- USER SCHEMA ---
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['student', 'admin'], default: 'student', index: true },
  department: { type: String, trim: true, default: 'General Academic' },
  academicYear: { type: String, trim: true, default: null },
  accountStatus: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
}, { timestamps: true });

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.__v;
  return obj;
};

export const User = mongoose.model('User', userSchema);

// --- RESOURCE SCHEMA ---
const resourceMongooseSchema = new mongoose.Schema({
  code: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true, minlength: 3, maxlength: 150, index: true },
  description: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: [
      'computer_lab',
      'seminar_hall',
      'classroom',
      'study_room',
      'projector_equipment',
      'sports_facility',
      'meeting_room',
      'lab_equipment',
    ],
    required: true,
    index: true,
  },
  building: { type: String, required: true, trim: true, index: true },
  floorRoom: { type: String, required: true, trim: true },
  capacity: { type: Number, required: true, min: 1, index: true },
  equipment: [{ type: String, trim: true }],
  imageUrl: {
    type: String,
    default: 'https://images.unsplash.com/photo-1562774053-701939374585?auto=format&fit=crop&w=1000&q=80',
  },
  operatingDays: {
    type: [String],
    default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  },
  openingTime: { type: String, required: true, default: '08:00' }, // HH:mm
  closingTime: { type: String, required: true, default: '21:00' }, // HH:mm
  minDurationMinutes: { type: Number, default: 30, min: 15 },
  maxDurationMinutes: { type: Number, default: 240, max: 720 },
  advanceBookingDaysLimit: { type: Number, default: 14, min: 1, max: 90 },
  requiresApproval: { type: Boolean, default: false },
  accessibilityDetails: { type: String, default: 'Standard campus wheelchair and ramp accessible.' },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

export const Resource = mongoose.model('Resource', resourceMongooseSchema);

// --- BOOKING SCHEMA ---
const bookingSchema = new mongoose.Schema({
  resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  startTime: { type: Date, required: true, index: true },
  endTime: { type: Date, required: true, index: true },
  purpose: { type: String, required: true, trim: true, minlength: 3, maxlength: 300 },
  attendeeCount: { type: Number, required: true, min: 1 },
  notes: { type: String, trim: true, maxlength: 500, default: '' },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'rejected', 'cancelled', 'completed'],
    default: 'pending',
    index: true,
  },
  approvalDetails: {
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
  },
  cancellationDetails: {
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: { type: Date },
    reason: { type: String, trim: true },
  },
  history: [
    {
      action: { type: String, required: true },
      performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      timestamp: { type: Date, default: Date.now },
      note: { type: String, default: '' },
    },
  ],
}, { timestamps: true });

// Compound indexes for fast conflict lookup and utilization queries
bookingSchema.index({ resource: 1, status: 1, startTime: 1, endTime: 1 });
bookingSchema.index({ user: 1, createdAt: -1 });

export const Booking = mongoose.model('Booking', bookingSchema);

// --- NOTIFICATION SCHEMA ---
const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['booking_created', 'booking_confirmed', 'booking_approved', 'booking_rejected', 'booking_cancelled', 'booking_completed', 'system'],
    default: 'system',
  },
  relatedBooking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  isRead: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

export const Notification = mongoose.model('Notification', notificationSchema);

// --- RESOURCE LOCK SCHEMA (Atomic Concurrency Control) ---
const resourceLockSchema = new mongoose.Schema({
  resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true, unique: true },
  lockedUntil: { type: Date, required: true, default: () => new Date(0) },
  lockedBy: { type: String, default: '' },
});

export const ResourceLock = mongoose.model('ResourceLock', resourceLockSchema);

// ==========================================
// 3. CONCURRENCY CONTROL & BOOKING ENGINE
// ==========================================

/**
 * Acquire a distributed atomic reservation lock on a resource for booking operations.
 * Protects against race conditions and concurrent double-bookings.
 */
export async function acquireResourceLock(resourceId, leaseMs = 4000, maxRetries = 10, retryDelayMs = 150) {
  const lockToken = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const now = new Date();
    const newLockExpiry = new Date(Date.now() + leaseMs);

    try {
      const lockDoc = await ResourceLock.findOneAndUpdate(
        {
          resource: resourceId,
          $or: [
            { lockedUntil: { $lte: now } },
            { lockedUntil: { $exists: false } },
          ],
        },
        {
          $set: {
            lockedUntil: newLockExpiry,
            lockedBy: lockToken,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (lockDoc && lockDoc.lockedBy === lockToken) {
        return lockToken;
      }
    } catch (err) {
      // Duplicate key or write conflict during upsert race; wait and retry
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs + Math.floor(Math.random() * 50)));
  }

  return null;
}

export async function releaseResourceLock(resourceId, lockToken) {
  if (!lockToken) return;
  try {
    await ResourceLock.updateOne(
      { resource: resourceId, lockedBy: lockToken },
      { $set: { lockedUntil: new Date(0), lockedBy: '' } }
    );
  } catch (err) {
    console.error(`[Lock Error] Failed to release lock on resource ${resourceId}:`, err.message);
  }
}

/**
 * Validates whether a requested booking interval satisfies operating hours and days.
 */
export function validateOperatingSchedule(resource, startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const startDay = daysOfWeek[start.getDay()];
  const endDay = daysOfWeek[end.getDay()];

  if (!resource.operatingDays.includes(startDay) || !resource.operatingDays.includes(endDay)) {
    return {
      valid: false,
      reason: `Resource is not open on ${startDay}. Permitted operating days: ${resource.operatingDays.join(', ')}.`,
    };
  }

  // Check opening and closing times (HH:mm in resource)
  const [openHour, openMin] = resource.openingTime.split(':').map(Number);
  const [closeHour, closeMin] = resource.closingTime.split(':').map(Number);

  const startTotalMinutes = start.getHours() * 60 + start.getMinutes();
  const endTotalMinutes = end.getHours() * 60 + end.getMinutes();
  const openTotalMinutes = openHour * 60 + openMin;
  const closeTotalMinutes = closeHour * 60 + closeMin;

  if (startTotalMinutes < openTotalMinutes || endTotalMinutes > closeTotalMinutes) {
    return {
      valid: false,
      reason: `Booking (${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}) is outside resource operating hours (${resource.openingTime} - ${resource.closingTime}).`,
    };
  }

  return { valid: true };
}

// ==========================================
// 4. AUTHENTICATION & VALIDATION MIDDLEWARE
// ==========================================

export function signToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function setAuthCookie(res, token) {
  res.cookie('campus_token', token, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export async function requireAuth(req, res, next) {
  try {
    let token = req.cookies?.campus_token;

    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ error: 'User account not found or session expired.' });
    }

    if (user.accountStatus !== 'active') {
      return res.status(403).json({ error: 'Your account has been suspended. Please contact an administrator.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication session.' });
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. You do not possess the required permissions.' });
    }
    next();
  };
}

// --- RATE LIMITERS ---
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' },
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Please throttle your requests.' },
});

// --- ZOD SCHEMAS ---
export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  department: z.string().trim().optional(),
  academicYear: z.string().trim().optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const resourceSchema = z.object({
  code: z.string().trim().optional(),
  name: z.string().trim().min(3).max(150),
  description: z.string().trim().min(10),
  type: z.enum([
    'computer_lab',
    'seminar_hall',
    'classroom',
    'study_room',
    'projector_equipment',
    'sports_facility',
    'meeting_room',
    'lab_equipment',
  ]),
  building: z.string().trim().min(2),
  floorRoom: z.string().trim().min(1),
  capacity: z.coerce.number().int().min(1),
  equipment: z.array(z.string().trim()).default([]),
  imageUrl: z.string().url().optional().or(z.literal('')),
  operatingDays: z.array(z.string()).min(1),
  openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Opening time must be in HH:mm format'),
  closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Closing time must be in HH:mm format'),
  minDurationMinutes: z.coerce.number().int().min(15),
  maxDurationMinutes: z.coerce.number().int().min(30),
  advanceBookingDaysLimit: z.coerce.number().int().min(1).max(90),
  requiresApproval: z.boolean().default(false),
  accessibilityDetails: z.string().trim().optional(),
  isActive: z.boolean().default(true),
});

export const bookingCreateSchema = z.object({
  resourceId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid Resource ID'),
  startTime: z.string().refine((val) => !isNaN(Date.parse(val)), 'Valid start date/time is required'),
  endTime: z.string().refine((val) => !isNaN(Date.parse(val)), 'Valid end date/time is required'),
  purpose: z.string().trim().min(3).max(300),
  attendeeCount: z.coerce.number().int().min(1),
  notes: z.string().trim().max(500).optional().default(''),
});

// ==========================================
// 5. DATABASE SEEDING ENGINE
// ==========================================

export async function seedDatabase(force = false) {
  if (NODE_ENV === 'production' && force) {
    throw new Error('Destructive seeding is strictly forbidden in production mode.');
  }

  console.log('[Seed] Starting database check and seeding routine...');

  // 1. Seed Users
  const usersPath = path.join(__dirname, 'src', 'data', 'users.json');
  let seededUsers = [];
  if (fs.existsSync(usersPath)) {
    const usersData = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    for (const u of usersData) {
      const existing = await User.findOne({ email: u.email.toLowerCase() });
      if (!existing) {
        const rawPassword = u.role === 'admin'
          ? (process.env.ADMIN_SEED_PASSWORD || 'AdminSecure2026!')
          : (process.env.STUDENT_SEED_PASSWORD || 'Student123!');
        const passwordHash = await bcrypt.hash(rawPassword, 10);
        const newUser = await User.create({
          name: u.name,
          email: u.email.toLowerCase(),
          passwordHash,
          role: u.role,
          department: u.department,
          academicYear: u.academicYear,
          accountStatus: u.accountStatus || 'active',
        });
        seededUsers.push(newUser);
      }
    }
  }

  // 2. Seed Resources
  const resourcesPath = path.join(__dirname, 'src', 'data', 'resources.json');
  let seededResources = [];
  if (fs.existsSync(resourcesPath)) {
    const resourcesData = JSON.parse(fs.readFileSync(resourcesPath, 'utf8'));
    for (const r of resourcesData) {
      const existing = await Resource.findOne({ $or: [{ code: r.code }, { name: r.name }] });
      if (!existing) {
        const newResource = await Resource.create(r);
        seededResources.push(newResource);
      }
    }
  }

  // 3. Seed Bookings
  const bookingsPath = path.join(__dirname, 'src', 'data', 'bookings.json');
  if (fs.existsSync(bookingsPath)) {
    const bookingsData = JSON.parse(fs.readFileSync(bookingsPath, 'utf8'));
    const totalBookingsCount = await Booking.countDocuments();

    if (totalBookingsCount === 0) {
      const allUsers = await User.find();
      const allResources = await Resource.find();

      const userMap = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]));
      const resourceMap = new Map(allResources.map((r) => [r.code, r]));

      for (const b of bookingsData) {
        const user = userMap.get(b.userEmail.toLowerCase());
        const resource = resourceMap.get(b.resourceCode);

        if (user && resource) {
          const now = new Date();
          const bookingDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (b.daysFromNow || 1));
          const startTime = new Date(bookingDate.setHours(b.startHour || 10, b.startMinute || 0, 0, 0));
          const endTime = new Date(startTime.getTime() + (b.durationMinutes || 60) * 60000);

          await Booking.create({
            resource: resource._id,
            user: user._id,
            startTime,
            endTime,
            purpose: b.purpose,
            attendeeCount: b.attendeeCount || 2,
            notes: b.notes || '',
            status: b.status || 'confirmed',
            approvalDetails: b.status === 'rejected' ? {
              rejectionReason: b.rejectionReason || 'Facility under routine calibration.',
              rejectedAt: new Date(),
            } : {},
            cancellationDetails: b.status === 'cancelled' ? {
              reason: b.cancellationReason || 'User requested schedule change.',
              cancelledAt: new Date(),
            } : {},
            history: [
              {
                action: 'created',
                performedBy: user._id,
                timestamp: new Date(startTime.getTime() - 24 * 3600000),
                note: 'Initial booking request submitted',
              },
            ],
          });
        }
      }
    }
  }

  console.log('[Seed] Seeding routine completed successfully.');
}

export async function runSeedCommand() {
  await connectDatabase();
  await seedDatabase(true);
  await disconnectDatabase();
  process.exit(0);
}

// ==========================================
// 6. EXPRESS APPLICATION & REST APIS
// ==========================================

export const app = express();

app.use(helmet({
  contentSecurityPolicy: false, // Allows flexible UI asset rendering in dev
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., mobile apps, curl, or same-origin)
    if (!origin || origin === CLIENT_ORIGIN || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS policy'));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use('/api/', apiLimiter);

// ------------------------------------------
// HEALTH & SYSTEM APIS
// ------------------------------------------
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStates = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const isHealthy = dbState === 1;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    api: 'online',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: {
      connected: isHealthy,
      state: dbStates[dbState] || 'unknown',
      host: mongoose.connection.host || 'none',
      name: mongoose.connection.name || 'none',
    },
  });
});

app.get('/api/stats/overview', async (req, res, next) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const [
      totalResources,
      activeResources,
      totalBookings,
      pendingApprovals,
      upcomingBookings,
      recentBookings,
    ] = await Promise.all([
      Resource.countDocuments(),
      Resource.countDocuments({ isActive: true }),
      Booking.countDocuments(),
      Booking.countDocuments({ status: 'pending' }),
      Booking.countDocuments({ status: 'confirmed', startTime: { $gte: now } }),
      Booking.find()
        .sort({ createdAt: -1 })
        .limit(6)
        .populate('resource', 'name type building floorRoom')
        .populate('user', 'name email department'),
    ]);

    // Calculate today's confirmed utilization
    const todayConfirmedBookings = await Booking.find({
      status: 'confirmed',
      startTime: { $lt: endOfToday },
      endTime: { $gt: startOfToday },
    });

    let totalBookedMinutesToday = 0;
    todayConfirmedBookings.forEach((b) => {
      const start = Math.max(b.startTime.getTime(), startOfToday.getTime());
      const end = Math.min(b.endTime.getTime(), endOfToday.getTime());
      if (end > start) {
        totalBookedMinutesToday += Math.round((end - start) / 60000);
      }
    });

    // Approximate total operating minutes today for active resources (assume 12 hours avg = 720 mins per resource)
    const totalOperatingMinutesToday = Math.max(activeResources * 720, 1);
    const utilizationRate = Math.min(
      100,
      Math.round((totalBookedMinutesToday / totalOperatingMinutesToday) * 100)
    );

    // Resources booked today
    const bookedResourceIds = new Set(todayConfirmedBookings.map((b) => b.resource.toString()));
    const availableResourcesToday = Math.max(0, activeResources - bookedResourceIds.size);

    res.json({
      totalResources,
      activeResources,
      availableResourcesToday,
      totalBookings,
      pendingApprovals,
      upcomingBookings,
      utilizationPercentage: utilizationRate,
      recentBookings,
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// AUTHENTICATION APIS
// ------------------------------------------
app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    const validated = registerSchema.parse(req.body);

    const existingUser = await User.findOne({ email: validated.email });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    const passwordHash = await bcrypt.hash(validated.password, 10);
    const user = await User.create({
      name: validated.name,
      email: validated.email,
      passwordHash,
      role: 'student', // Public registration is strictly student role
      department: validated.department || 'General Academic',
      academicYear: validated.academicYear || 'Year 1',
    });

    const token = signToken(user);
    setAuthCookie(res, token);

    // Welcome Notification
    await Notification.create({
      recipient: user._id,
      title: 'Welcome to Smart Campus Booking!',
      message: `Hello ${user.name}, your student account is active. You can now explore resources and submit reservation requests.`,
      type: 'system',
    });

    res.status(201).json({
      message: 'Registration successful',
      user: user.toJSON(),
      token,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const validated = loginSchema.parse(req.body);

    const user = await User.findOne({ email: validated.email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email address or password.' });
    }

    const isMatch = await bcrypt.compare(validated.password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email address or password.' });
    }

    if (user.accountStatus !== 'active') {
      return res.status(403).json({ error: 'Your account is suspended. Please contact the campus administrator.' });
    }

    const token = signToken(user);
    setAuthCookie(res, token);

    res.json({
      message: 'Login successful',
      user: user.toJSON(),
      token,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('campus_token', {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ message: 'Logged out successfully.' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toJSON() });
});

// ------------------------------------------
// RESOURCE APIS
// ------------------------------------------
app.get('/api/resources', async (req, res, next) => {
  try {
    const {
      search,
      type,
      minCapacity,
      isActive,
      page = 1,
      limit = 12,
      sort = 'name',
    } = req.query;

    const query = {};

    if (isActive !== undefined && isActive !== '') {
      query.isActive = isActive === 'true';
    } else {
      // By default show active resources to students, but admins can query all
      if (!req.query.all) {
        query.isActive = true;
      }
    }

    if (type) {
      query.type = type;
    }

    if (minCapacity) {
      query.capacity = { $gte: parseInt(minCapacity, 10) };
    }

    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: regex },
        { building: regex },
        { floorRoom: regex },
        { description: regex },
        { equipment: regex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const sortOptions = {};
    if (sort === 'capacity_asc') sortOptions.capacity = 1;
    else if (sort === 'capacity_desc') sortOptions.capacity = -1;
    else if (sort === 'newest') sortOptions.createdAt = -1;
    else sortOptions.name = 1;

    const [resources, total] = await Promise.all([
      Resource.find(query).sort(sortOptions).skip(skip).limit(limitNum),
      Resource.countDocuments(query),
    ]);

    res.json({
      resources,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/resources/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Resource ID format.' });
    }
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found.' });
    }
    res.json({ resource });
  } catch (err) {
    next(err);
  }
});

app.post('/api/resources', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const validated = resourceSchema.parse(req.body);
    const resource = await Resource.create(validated);
    res.status(201).json({ message: 'Resource created successfully.', resource });
  } catch (err) {
    next(err);
  }
});

app.put('/api/resources/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Resource ID format.' });
    }
    const validated = resourceSchema.parse(req.body);
    const updated = await Resource.findByIdAndUpdate(req.params.id, validated, { new: true, runValidators: true });
    if (!updated) {
      return res.status(404).json({ error: 'Resource not found.' });
    }
    res.json({ message: 'Resource updated successfully.', resource: updated });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/resources/:id/status', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Resource ID format.' });
    }
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean value.' });
    }

    const updated = await Resource.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: 'Resource not found.' });
    }
    res.json({ message: `Resource ${isActive ? 'activated' : 'deactivated'} successfully.`, resource: updated });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/resources/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Resource ID format.' });
    }

    // Preserve historical integrity: check if any bookings exist for this resource
    const bookingCount = await Booking.countDocuments({ resource: req.params.id });
    if (bookingCount > 0) {
      return res.status(400).json({
        error: `Cannot delete resource because it has ${bookingCount} historical or active reservation records. Please deactivate it instead to preserve audit logs.`,
      });
    }

    const deleted = await Resource.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Resource not found.' });
    }
    res.json({ message: 'Resource deleted successfully.' });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// AVAILABILITY CALENDAR API
// ------------------------------------------
app.get('/api/resources/:id/availability', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Resource ID format.' });
    }

    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found.' });
    }

    const dateStr = req.query.date; // YYYY-MM-DD
    const targetDate = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();

    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
    }

    const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
    const dayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999);

    // Active occupied intervals: confirmed or pending reservations
    const occupiedBookings = await Booking.find({
      resource: resource._id,
      status: { $in: ['confirmed', 'pending'] },
      startTime: { $lt: dayEnd },
      endTime: { $gt: dayStart },
    }).select('startTime endTime status purpose');

    const blockedIntervals = occupiedBookings.map((b) => ({
      id: b._id,
      startTime: b.startTime,
      endTime: b.endTime,
      status: b.status,
      purpose: b.purpose,
    }));

    // Operating hours for this date
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDayName = daysOfWeek[targetDate.getDay()];
    const isOpenOnDate = resource.isActive && resource.operatingDays.includes(currentDayName);

    res.json({
      resource: {
        id: resource._id,
        name: resource.name,
        operatingDays: resource.operatingDays,
        openingTime: resource.openingTime,
        closingTime: resource.closingTime,
        minDurationMinutes: resource.minDurationMinutes,
        maxDurationMinutes: resource.maxDurationMinutes,
        advanceBookingDaysLimit: resource.advanceBookingDaysLimit,
        isOpenOnDate,
      },
      date: targetDate.toISOString().split('T')[0],
      dayOfWeek: currentDayName,
      blockedIntervals,
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// BOOKING ENGINE APIS
// ------------------------------------------
app.post('/api/bookings', requireAuth, async (req, res, next) => {
  let lockToken = null;
  const resourceId = req.body.resourceId;

  try {
    const validated = bookingCreateSchema.parse(req.body);
    const startTime = new Date(validated.startTime);
    const endTime = new Date(validated.endTime);
    const now = new Date();

    // 1. Time boundary check: end > start
    if (endTime.getTime() <= startTime.getTime()) {
      return res.status(400).json({ error: 'Reservation end time must be later than start time.' });
    }

    // 2. Disallow past bookings
    if (startTime.getTime() < now.getTime() - 60000) {
      return res.status(400).json({ error: 'Reservations cannot be created for past dates or times.' });
    }

    // 3. Find resource
    const resource = await Resource.findById(validated.resourceId);
    if (!resource) {
      return res.status(404).json({ error: 'Requested campus resource was not found.' });
    }

    // 4. Check active status
    if (!resource.isActive) {
      return res.status(400).json({ error: 'This resource is currently deactivated and cannot be reserved.' });
    }

    // 5. Capacity check
    if (validated.attendeeCount > resource.capacity) {
      return res.status(400).json({
        error: `Requested attendees (${validated.attendeeCount}) exceeds maximum resource capacity (${resource.capacity}).`,
      });
    }

    // 6. Duration checks
    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
    if (durationMinutes < resource.minDurationMinutes) {
      return res.status(400).json({
        error: `Reservation duration (${durationMinutes} mins) is below the minimum allowed (${resource.minDurationMinutes} mins).`,
      });
    }
    if (durationMinutes > resource.maxDurationMinutes) {
      return res.status(400).json({
        error: `Reservation duration (${durationMinutes} mins) exceeds the maximum allowed (${resource.maxDurationMinutes} mins).`,
      });
    }

    // 7. Advance booking limit
    const advanceDays = Math.ceil((startTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (advanceDays > resource.advanceBookingDaysLimit) {
      return res.status(400).json({
        error: `Reservations cannot be made more than ${resource.advanceBookingDaysLimit} days in advance.`,
      });
    }

    // 8. Operating schedule check
    const scheduleCheck = validateOperatingSchedule(resource, startTime, endTime);
    if (!scheduleCheck.valid) {
      return res.status(400).json({ error: scheduleCheck.reason });
    }

    // 9. CONCURRENCY CONTROL: Acquire atomic reservation lock on resource
    lockToken = await acquireResourceLock(resource._id);
    if (!lockToken) {
      return res.status(503).json({
        error: 'High booking concurrency detected for this resource. Please retry your submission in a moment.',
      });
    }

    // 10. RE-CHECK CONFLICTS inside critical section
    // Overlap rule: existingStart < requestedEnd AND existingEnd > requestedStart (Half-open intervals [start, end))
    const conflictingBooking = await Booking.findOne({
      resource: resource._id,
      status: { $in: ['confirmed', 'pending'] },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    });

    if (conflictingBooking) {
      const conflictStart = conflictingBooking.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const conflictEnd = conflictingBooking.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return res.status(409).json({
        error: `Time conflict detected: This facility is already booked from ${conflictStart} to ${conflictEnd}. Please select another time slot.`,
        conflict: {
          startTime: conflictingBooking.startTime,
          endTime: conflictingBooking.endTime,
          status: conflictingBooking.status,
        },
      });
    }

    // 11. Determine initial status based on resource approval policy
    const initialStatus = resource.requiresApproval ? 'pending' : 'confirmed';

    // 12. Create the booking
    const newBooking = await Booking.create({
      resource: resource._id,
      user: req.user._id,
      startTime,
      endTime,
      purpose: validated.purpose,
      attendeeCount: validated.attendeeCount,
      notes: validated.notes || '',
      status: initialStatus,
      history: [
        {
          action: 'created',
          performedBy: req.user._id,
          timestamp: new Date(),
          note: `Booking created with initial status '${initialStatus}'`,
        },
      ],
    });

    // 13. Create In-App Notification for User
    await Notification.create({
      recipient: req.user._id,
      title: initialStatus === 'confirmed' ? 'Booking Confirmed!' : 'Booking Request Submitted',
      message: initialStatus === 'confirmed'
        ? `Your reservation for "${resource.name}" on ${startTime.toLocaleDateString()} is confirmed.`
        : `Your reservation request for "${resource.name}" has been received and is pending administrator review.`,
      type: 'booking_created',
      relatedBooking: newBooking._id,
    });

    const populatedBooking = await Booking.findById(newBooking._id)
      .populate('resource', 'name type building floorRoom imageUrl')
      .populate('user', 'name email department');

    res.status(201).json({
      message: initialStatus === 'confirmed' ? 'Reservation confirmed successfully!' : 'Reservation request submitted for approval.',
      booking: populatedBooking,
    });
  } catch (err) {
    next(err);
  } finally {
    if (lockToken && resourceId) {
      await releaseResourceLock(resourceId, lockToken);
    }
  }
});

app.get('/api/bookings', requireAuth, async (req, res, next) => {
  try {
    const {
      status,
      resourceId,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 10,
      sort = 'newest',
    } = req.query;

    const query = {};

    // Role-based scoping: students can ONLY view their own bookings; admins can see all
    if (req.user.role !== 'admin') {
      query.user = req.user._id;
    } else if (req.query.userId) {
      query.user = req.query.userId;
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (resourceId && mongoose.Types.ObjectId.isValid(resourceId)) {
      query.resource = resourceId;
    }

    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    if (search) {
      query.purpose = new RegExp(search.trim(), 'i');
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const sortOptions = {};
    if (sort === 'oldest') sortOptions.startTime = 1;
    else if (sort === 'event_date') sortOptions.startTime = 1;
    else sortOptions.createdAt = -1;

    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .populate('resource', 'name type building floorRoom imageUrl requiresApproval capacity')
        .populate('user', 'name email department academicYear'),
      Booking.countDocuments(query),
    ]);

    res.json({
      bookings,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/bookings/:id', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Booking ID format.' });
    }

    const booking = await Booking.findById(req.params.id)
      .populate('resource')
      .populate('user', 'name email department academicYear')
      .populate('history.performedBy', 'name email role');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    // Role check: students can only view their own
    if (req.user.role !== 'admin' && booking.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied. You do not own this booking record.' });
    }

    res.json({ booking });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/bookings/:id/status', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Booking ID format.' });
    }

    const { status, reason } = req.body;
    if (!['confirmed', 'rejected', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Status must be one of: confirmed, rejected, completed.' });
    }

    const booking = await Booking.findById(req.params.id).populate('resource');
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    // Disallow invalid status transitions
    if (['rejected', 'cancelled'].includes(booking.status)) {
      return res.status(400).json({ error: `Cannot change status of an already ${booking.status} booking.` });
    }

    // If approving a pending booking, re-verify conflicts right now
    if (status === 'confirmed' && booking.status === 'pending') {
      const conflict = await Booking.findOne({
        _id: { $ne: booking._id },
        resource: booking.resource._id,
        status: 'confirmed',
        startTime: { $lt: booking.endTime },
        endTime: { $gt: booking.startTime },
      });
      if (conflict) {
        return res.status(409).json({ error: 'Cannot approve: another confirmed reservation now conflicts with this time slot.' });
      }
    }

    booking.status = status;

    if (status === 'confirmed') {
      booking.approvalDetails = {
        ...booking.approvalDetails,
        approvedBy: req.user._id,
        approvedAt: new Date(),
      };
    } else if (status === 'rejected') {
      booking.approvalDetails = {
        ...booking.approvalDetails,
        rejectedBy: req.user._id,
        rejectedAt: new Date(),
        rejectionReason: reason || 'Resource unavailable or booking policy not met.',
      };
    }

    booking.history.push({
      action: status,
      performedBy: req.user._id,
      timestamp: new Date(),
      note: reason || `Booking marked as ${status} by administrator.`,
    });

    await booking.save();

    // Create Notification for the student
    await Notification.create({
      recipient: booking.user,
      title: status === 'confirmed' ? 'Booking Approved!' : (status === 'rejected' ? 'Booking Request Declined' : 'Booking Completed'),
      message: status === 'confirmed'
        ? `Your booking request for "${booking.resource.name}" has been approved.`
        : (status === 'rejected'
            ? `Your booking request for "${booking.resource.name}" was rejected. Reason: ${reason || 'Capacity or policy restriction.'}`
            : `Your booking for "${booking.resource.name}" is now marked as completed.`),
      type: status === 'confirmed' ? 'booking_approved' : (status === 'rejected' ? 'booking_rejected' : 'booking_completed'),
      relatedBooking: booking._id,
    });

    res.json({ message: `Booking status updated to ${status}.`, booking });
  } catch (err) {
    next(err);
  }
});

app.post('/api/bookings/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Booking ID format.' });
    }

    const { reason } = req.body;
    const booking = await Booking.findById(req.params.id).populate('resource');
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    // Role check: Only owner or admin can cancel
    if (req.user.role !== 'admin' && booking.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'You are not authorized to cancel this booking.' });
    }

    if (['cancelled', 'rejected', 'completed'].includes(booking.status)) {
      return res.status(400).json({ error: `Cannot cancel a booking with status '${booking.status}'.` });
    }

    booking.status = 'cancelled';
    booking.cancellationDetails = {
      cancelledBy: req.user._id,
      cancelledAt: new Date(),
      reason: reason || 'Cancelled by user request.',
    };

    booking.history.push({
      action: 'cancelled',
      performedBy: req.user._id,
      timestamp: new Date(),
      note: reason || 'Cancelled',
    });

    await booking.save();

    // Notify user if cancelled by admin, or notify student confirmation
    await Notification.create({
      recipient: booking.user,
      title: 'Booking Cancelled',
      message: `Your booking for "${booking.resource.name}" on ${booking.startTime.toLocaleDateString()} has been cancelled.`,
      type: 'booking_cancelled',
      relatedBooking: booking._id,
    });

    res.json({ message: 'Booking cancelled successfully.', booking });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// NOTIFICATION APIS
// ------------------------------------------
app.get('/api/notifications', requireAuth, async (req, res, next) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 })
      .limit(30);
    const unreadCount = await Notification.countDocuments({ recipient: req.user._id, isRead: false });

    res.json({ notifications, unreadCount });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/notifications/:id/read', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Notification ID.' });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found or unauthorized.' });
    }

    res.json({ message: 'Notification marked as read.', notification });
  } catch (err) {
    next(err);
  }
});

app.post('/api/notifications/read-all', requireAuth, async (req, res, next) => {
  try {
    await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
    res.json({ message: 'All notifications marked as read.' });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// USER & ADMIN MANAGEMENT APIS
// ------------------------------------------
app.get('/api/users/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toJSON() });
});

app.get('/api/admin/users', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { search, role, status, page = 1, limit = 15 } = req.query;
    const query = {};

    if (role) query.role = role;
    if (status) query.accountStatus = status;
    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ name: regex }, { email: regex }, { department: regex }];
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      User.countDocuments(query),
    ]);

    res.json({
      users: users.map((u) => u.toJSON()),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/admin/users/:id/role', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid User ID format.' });
    }

    const { role } = req.body;
    if (!['student', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be student or admin.' });
    }

    // Safety guard: Prevent removing the last active administrator!
    if (role === 'student') {
      const targetUser = await User.findById(req.params.id);
      if (targetUser && targetUser.role === 'admin') {
        const activeAdminCount = await User.countDocuments({ role: 'admin', accountStatus: 'active' });
        if (activeAdminCount <= 1) {
          return res.status(400).json({
            error: 'System protection error: Cannot demote the last active administrator.',
          });
        }
      }
    }

    const updated = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!updated) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ message: `User role updated to ${role}.`, user: updated.toJSON() });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/admin/users/:id/status', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid User ID format.' });
    }

    const { accountStatus } = req.body;
    if (!['active', 'suspended'].includes(accountStatus)) {
      return res.status(400).json({ error: 'Status must be active or suspended.' });
    }

    // Safety guard: cannot suspend self or last admin
    if (req.params.id === req.user._id.toString() && accountStatus === 'suspended') {
      return res.status(400).json({ error: 'You cannot suspend your own active administrator account.' });
    }

    const updated = await User.findByIdAndUpdate(req.params.id, { accountStatus }, { new: true });
    if (!updated) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ message: `User status updated to ${accountStatus}.`, user: updated.toJSON() });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// REPORTS & ANALYTICS APIS
// ------------------------------------------
app.get('/api/reports/usage', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const now = new Date();
    const periodStart = startDate ? new Date(startDate) : new Date(now.getTime() - 30 * 24 * 3600000);
    const periodEnd = endDate ? new Date(endDate) : now;

    // 1. Booking status distribution
    const statusCounts = await Booking.aggregate([
      { $match: { createdAt: { $gte: periodStart, $lte: periodEnd } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const statusMap = { pending: 0, confirmed: 0, rejected: 0, cancelled: 0, completed: 0 };
    statusCounts.forEach((sc) => {
      statusMap[sc._id] = sc.count;
    });

    // 2. Bookings grouped by Resource Type
    const typeBreakdown = await Booking.aggregate([
      { $match: { createdAt: { $gte: periodStart, $lte: periodEnd } } },
      {
        $lookup: {
          from: 'resources',
          localField: 'resource',
          foreignField: '_id',
          as: 'resourceDoc',
        },
      },
      { $unwind: '$resourceDoc' },
      {
        $group: {
          _id: '$resourceDoc.type',
          totalBookings: { $sum: 1 },
          confirmedMinutes: {
            $sum: {
              $cond: [
                { $in: ['$status', ['confirmed', 'completed']] },
                { $divide: [{ $subtract: ['$endTime', '$startTime'] }, 60000] },
                0,
              ],
            },
          },
        },
      },
      { $sort: { totalBookings: -1 } },
    ]);

    // 3. Most booked facilities
    const topFacilities = await Booking.aggregate([
      { $match: { createdAt: { $gte: periodStart, $lte: periodEnd }, status: { $in: ['confirmed', 'completed'] } } },
      { $group: { _id: '$resource', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'resources',
          localField: '_id',
          foreignField: '_id',
          as: 'facility',
        },
      },
      { $unwind: '$facility' },
      {
        $project: {
          name: '$facility.name',
          type: '$facility.type',
          building: '$facility.building',
          count: 1,
        },
      },
    ]);

    // 4. Utilization rate calculation
    // Formula: (confirmed_booked_minutes / bookable_operating_minutes) * 100
    const activeResources = await Resource.find({ isActive: true });
    const periodDays = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)));
    
    // Total bookable minutes = activeResources * operatingMinutesPerDay * periodDays
    let totalBookableMinutes = 0;
    activeResources.forEach((r) => {
      const [oH, oM] = r.openingTime.split(':').map(Number);
      const [cH, cM] = r.closingTime.split(':').map(Number);
      const dailyMinutes = Math.max(0, (cH * 60 + cM) - (oH * 60 + oM));
      totalBookableMinutes += dailyMinutes * periodDays;
    });

    const confirmedBookings = await Booking.find({
      status: { $in: ['confirmed', 'completed'] },
      startTime: { $lt: periodEnd },
      endTime: { $gt: periodStart },
    });

    let totalConfirmedBookedMinutes = 0;
    confirmedBookings.forEach((b) => {
      const s = Math.max(b.startTime.getTime(), periodStart.getTime());
      const e = Math.min(b.endTime.getTime(), periodEnd.getTime());
      if (e > s) {
        totalConfirmedBookedMinutes += Math.round((e - s) / 60000);
      }
    });

    const utilizationPercentage = totalBookableMinutes > 0
      ? Math.min(100, Math.round((totalConfirmedBookedMinutes / totalBookableMinutes) * 100))
      : 0;

    res.json({
      period: {
        startDate: periodStart.toISOString(),
        endDate: periodEnd.toISOString(),
        periodDays,
      },
      utilization: {
        totalBookableMinutes,
        totalConfirmedBookedMinutes,
        utilizationPercentage,
        formula: '(confirmedBookedMinutes / bookableOperatingMinutes) * 100',
      },
      statusDistribution: statusMap,
      typeBreakdown,
      topFacilities,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/reports/bookings', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { startDate, endDate, format } = req.query;
    const query = {};

    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) query.startTime.$gte = new Date(startDate);
      if (endDate) query.startTime.$lte = new Date(endDate);
    }

    const bookings = await Booking.find(query)
      .sort({ startTime: -1 })
      .populate('resource', 'name type building floorRoom')
      .populate('user', 'name email department');

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="campus_bookings_report.csv"');

      let csv = 'Booking ID,Resource Name,Resource Type,Building,User Name,User Email,Department,Start Time,End Time,Status,Attendees,Purpose\n';

      bookings.forEach((b) => {
        const escapeCsv = (str) => `"${String(str || '').replace(/"/g, '""')}"`;
        csv += [
          escapeCsv(b._id),
          escapeCsv(b.resource?.name),
          escapeCsv(b.resource?.type),
          escapeCsv(b.resource?.building),
          escapeCsv(b.user?.name),
          escapeCsv(b.user?.email),
          escapeCsv(b.user?.department),
          escapeCsv(b.startTime?.toISOString()),
          escapeCsv(b.endTime?.toISOString()),
          escapeCsv(b.status),
          escapeCsv(b.attendeeCount),
          escapeCsv(b.purpose),
        ].join(',') + '\n';
      });

      return res.send(csv);
    }

    res.json({ bookings, count: bookings.length });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------
// STATIC FRONTEND SERVING IN PRODUCTION
// ------------------------------------------
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ------------------------------------------
// CENTRALIZED ERROR HANDLER
// ------------------------------------------
app.use((err, req, res, next) => {
  // Handle Zod Validation Errors
  if (err instanceof z.ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return res.status(400).json({
      error: formattedErrors[0]?.message || 'Input validation failed.',
      validationErrors: formattedErrors,
    });
  }

  // Handle Mongoose Duplicate Key Error (E11000)
  if (err.code === 11000) {
    const duplicateField = Object.keys(err.keyPattern || {})[0] || 'field';
    return res.status(409).json({
      error: `A record with this ${duplicateField} already exists in the system.`,
    });
  }

  // Handle Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `Invalid format for parameter: ${err.path}` });
  }

  console.error('[Unhandled Server Error]', err);
  const status = err.status || 500;
  const message = NODE_ENV === 'production' && status === 500
    ? 'An unexpected internal campus server error occurred.'
    : err.message || 'Internal Server Error';

  res.status(status).json({ error: message });
});

// ==========================================
// 7. SERVER INITIALIZATION & STARTUP
// ==========================================

export let server = null;

export async function startServer(port = PORT) {
  await connectDatabase();
  return new Promise((resolve, reject) => {
    server = http.createServer(app);
    server.listen(port, () => {
      console.log(`[Express API] Smart Campus Server running on port ${port} (${NODE_ENV} mode)`);
      resolve(server);
    });
    server.on('error', (err) => {
      console.error(`[Server Error] ${err.message}`);
      reject(err);
    });
  });
}

// Auto-start when executed directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startServer().catch((err) => {
    console.error('Fatal initialization error:', err);
    process.exit(1);
  });
}
