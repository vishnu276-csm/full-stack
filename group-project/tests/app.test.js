import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';

import {
  app,
  User,
  Resource,
  Booking,
  Notification,
  signToken,
  acquireResourceLock,
  releaseResourceLock,
} from '../server.js';

let mongoServer;
let adminUser;
let studentUser1;
let studentUser2;
let adminToken;
let studentToken1;
let studentToken2;
let testResource;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // Setup Admin user
  const adminPasswordHash = await bcrypt.hash('AdminSecure2026!', 10);
  adminUser = await User.create({
    name: 'Dr. Sarah Mitchell',
    email: 'admin.test@campus.edu',
    passwordHash: adminPasswordHash,
    role: 'admin',
    department: 'Campus Operations',
  });
  adminToken = signToken(adminUser);

  // Setup Student 1
  const studentPasswordHash = await bcrypt.hash('Student123!', 10);
  studentUser1 = await User.create({
    name: 'Alex Chen',
    email: 'alex.chen.test@campus.edu',
    passwordHash: studentPasswordHash,
    role: 'student',
    department: 'Computer Science',
    academicYear: 'Year 3',
  });
  studentToken1 = signToken(studentUser1);

  // Setup Student 2
  studentUser2 = await User.create({
    name: 'Priya Sharma',
    email: 'priya.sharma.test@campus.edu',
    passwordHash: studentPasswordHash,
    role: 'student',
    department: 'AI & Data Science',
    academicYear: 'Year 4',
  });
  studentToken2 = signToken(studentUser2);

  // Setup standard test resource (open Monday-Friday, 08:00 - 20:00)
  testResource = await Resource.create({
    code: 'RES-TEST-LAB',
    name: 'Turing Computer Lab (Test)',
    description: 'Advanced testing lab with 30 workstations and projectors.',
    type: 'computer_lab',
    building: 'Turing Center',
    floorRoom: 'Room 101',
    capacity: 30,
    equipment: ['Workstations', 'Projector'],
    operatingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    openingTime: '08:00',
    closingTime: '20:00',
    minDurationMinutes: 30,
    maxDurationMinutes: 240,
    advanceBookingDaysLimit: 14,
    requiresApproval: true,
    isActive: true,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

// Helper for relative dates
function getFutureDate(daysAhead, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, minute, 0, 0);
  return date;
}

// ==========================================
// 1. HEALTH & SYSTEM TESTS
// ==========================================
describe('Health and System APIs', () => {
  it('GET /api/health should report online and database connected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database.connected).toBe(true);
  });

  it('GET /api/stats/overview should return dashboard statistics', async () => {
    const res = await request(app).get('/api/stats/overview');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('activeResources');
    expect(res.body).toHaveProperty('totalBookings');
    expect(res.body).toHaveProperty('utilizationPercentage');
  });
});

// ==========================================
// 2. AUTHENTICATION & ACCESS CONTROL TESTS
// ==========================================
describe('Authentication & Access Control', () => {
  it('POST /api/auth/register should register a student with hashed password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Elena Rostova',
        email: 'elena.rostova@campus.edu',
        password: 'Password123!',
        department: 'Architecture',
      });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.role).toBe('student');
    expect(res.body.user.passwordHash).toBeUndefined();

    // Verify in database that password is not plain text
    const savedUser = await User.findOne({ email: 'elena.rostova@campus.edu' });
    expect(savedUser.passwordHash).not.toBe('Password123!');
    expect(savedUser.passwordHash.startsWith('$2')).toBe(true);
  });

  it('POST /api/auth/register should reject duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Duplicate Alex',
        email: 'alex.chen.test@campus.edu',
        password: 'Password123!',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('POST /api/auth/login should authenticate valid user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alex.chen.test@campus.edu',
        password: 'Student123!',
      });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('alex.chen.test@campus.edu');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('POST /api/auth/login should reject invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alex.chen.test@campus.edu',
        password: 'WrongPassword!',
      });

    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me should return current user for authenticated session', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${studentToken1}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('alex.chen.test@campus.edu');
  });

  it('GET /api/auth/me should return 401 when unauthorized', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/logout should clear session cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);
  });
});

// ==========================================
// 3. RESOURCE CRUD & ADMIN AUTHORIZATION
// ==========================================
describe('Resource Management & Admin Restrictions', () => {
  it('Non-admin student cannot create resources (403 Forbidden)', async () => {
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${studentToken1}`)
      .send({
        name: 'Unauthorized Student Lab',
        description: 'Should not be created',
        type: 'computer_lab',
        building: 'Science Hall',
        floorRoom: 'Room 201',
        capacity: 20,
        openingTime: '08:00',
        closingTime: '20:00',
        operatingDays: ['Monday'],
        minDurationMinutes: 30,
        maxDurationMinutes: 120,
        advanceBookingDaysLimit: 7,
      });

    expect(res.status).toBe(403);
  });

  it('Administrator can create a new campus resource', async () => {
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'New Quantum Computing Suite',
        description: 'State of the art cryogenic and quantum computing workstation.',
        type: 'computer_lab',
        building: 'Physics Block',
        floorRoom: 'B1-04',
        capacity: 15,
        equipment: ['Qubit Simulator', 'Cryogenic Monitor'],
        openingTime: '09:00',
        closingTime: '18:00',
        operatingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        minDurationMinutes: 60,
        maxDurationMinutes: 180,
        advanceBookingDaysLimit: 14,
        requiresApproval: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.resource.name).toBe('New Quantum Computing Suite');
  });

  it('Administrator can toggle resource active/inactive status', async () => {
    const res = await request(app)
      .patch(`/api/resources/${testResource._id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.resource.isActive).toBe(false);

    // Re-activate for further booking tests
    await Resource.findByIdAndUpdate(testResource._id, { isActive: true });
  });

  it('Prevent deletion of resource that has booking records', async () => {
    // Create a dummy booking for testResource
    const dummyStart = getFutureDate(1, 10);
    const dummyEnd = getFutureDate(1, 11);
    const booking = await Booking.create({
      resource: testResource._id,
      user: studentUser1._id,
      startTime: dummyStart,
      endTime: dummyEnd,
      purpose: 'Testing deletion guard',
      attendeeCount: 2,
      status: 'confirmed',
    });

    const res = await request(app)
      .delete(`/api/resources/${testResource._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot delete resource because it has/i);

    // Clean up dummy booking
    await Booking.findByIdAndDelete(booking._id);
  });

  it('Admin protection: cannot demote the last active administrator', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${adminUser._id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'student' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last active administrator/i);
  });
});

// ==========================================
// 4. BOOKING ENGINE & CONFLICT PREVENTION TESTS
// ==========================================
describe('Booking Engine & Conflict Prevention (Core Rules)', () => {
  beforeEach(async () => {
    // Clean all bookings for a pristine state before each test
    await Booking.deleteMany({});
  });

  it('1. A reservation can be created when a resource is available', async () => {
    const startTime = getFutureDate(2, 10, 0); // Day 2, 10:00
    const endTime = getFutureDate(2, 12, 0);   // Day 2, 12:00

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${studentToken1}`)
      .send({
        resourceId: testResource._id.toString(),
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        purpose: 'Deep Learning Training Workshop',
        attendeeCount: 10,
        notes: 'GPU required',
      });

    expect(res.status).toBe(201);
    expect(res.body.booking).toBeDefined();
    expect(res.body.booking.status).toBe('pending'); // testResource has requiresApproval: true
  });

  it('2. An overlapping active reservation is rejected with HTTP 409 Conflict', async () => {
    const start1 = getFutureDate(2, 10, 0);
    const end1 = getFutureDate(2, 12, 0);

    // Initial booking: 10:00 to 12:00
    await Booking.create({
      resource: testResource._id,
      user: studentUser1._id,
      startTime: start1,
      endTime: end1,
      purpose: 'Existing Reservation',
      attendeeCount: 5,
      status: 'confirmed',
    });

    // Overlapping attempt: 11:00 to 13:00 (overlaps [11:00, 12:00))
    const start2 = getFutureDate(2, 11, 0);
    const end2 = getFutureDate(2, 13, 0);

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${studentToken2}`)
      .send({
        resourceId: testResource._id.toString(),
        startTime: start2.toISOString(),
        endTime: end2.toISOString(),
        purpose: 'Conflicting Workshop Attempt',
        attendeeCount: 4,
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/conflict detected/i);
    expect(res.body.conflict).toBeDefined();
  });

  it('3. Back-to-back reservations are permitted (half-open intervals)', async () => {
    const start1 = getFutureDate(2, 10, 0);
    const end1 = getFutureDate(2, 11, 0);

    // Initial booking: 10:00 to 11:00
    await Booking.create({
      resource: testResource._id,
      user: studentUser1._id,
      startTime: start1,
      endTime: end1,
      purpose: 'Morning Session',
      attendeeCount: 4,
      status: 'confirmed',
    });

    // Back-to-back booking: starts exactly at 11:00 to 12:00
    const start2 = getFutureDate(2, 11, 0);
    const end2 = getFutureDate(2, 12, 0);

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${studentToken2}`)
      .send({
        resourceId: testResource._id.toString(),
        startTime: start2.toISOString(),
        endTime: end2.toISOString(),
        purpose: 'Consecutive Back-to-Back Session',
        attendeeCount: 6,
      });

    expect(res.status).toBe(201);
    expect(res.body.booking).toBeDefined();
  });

  it('4. A cancelled reservation no longer blocks availability', async () => {
    const start = getFutureDate(3, 14, 0);
    const end = getFutureDate(3, 16, 0);

    // Cancelled booking in that slot
    await Booking.create({
      resource: testResource._id,
      user: studentUser1._id,
      startTime: start,
      endTime: end,
      purpose: 'Cancelled Event',
      attendeeCount: 5,
      status: 'cancelled',
    });

    // New booking requesting the exact same slot
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${studentToken2}`)
      .send({
        resourceId: testResource._id.toString(),
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        purpose: 'New Student Booking on Cancelled Slot',
        attendeeCount: 5,
      });

    expect(res.status).toBe(201);
  });

  it('5. A rejected reservation does not block availability', async () => {
    const start = getFutureDate(3, 14, 0);
    const end = getFutureDate(3, 16, 0);

    // Rejected booking
    await Booking.create({
      resource: testResource._id,
      user: studentUser1._id,
      startTime: start,
      endTime: end,
      purpose: 'Rejected Session',
      attendeeCount: 5,
      status: 'rejected',
    });

    // New booking requesting the slot
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${studentToken2}`)
      .send({
        resourceId: testResource._id.toString(),
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        purpose: 'Fresh Request',
        attendeeCount: 5,
      });

    expect(res.status).toBe(201);
  });

  it('6. Requests with invalid start and end times are rejected', async () => {
    // End time before start time
    const start = getFutureDate(2, 14, 0);
    const end = getFutureDate(2, 13, 0);

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${studentToken1}`)
      .send({
        resourceId: testResource._id.toString(),
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        purpose: 'Invalid Time Order',
        attendeeCount: 2,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/end time must be later/i);
  });

  it('7. Attendee counts exceeding capacity are rejected', async () => {
    const start = getFutureDate(2, 10, 0);
    const end = getFutureDate(2, 12, 0);

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${studentToken1}`)
      .send({
        resourceId: testResource._id.toString(),
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        purpose: 'Overcapacity Event',
        attendeeCount: testResource.capacity + 15, // capacity is 30, requested 45
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds maximum resource capacity/i);
  });

  it('8. Reservations outside operating hours are rejected', async () => {
    // testResource operating hours are 08:00 to 20:00
    // Requesting 21:00 to 22:00
    const start = getFutureDate(2, 21, 0);
    const end = getFutureDate(2, 22, 0);

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${studentToken1}`)
      .send({
        resourceId: testResource._id.toString(),
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        purpose: 'Midnight Hack',
        attendeeCount: 2,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outside resource operating hours/i);
  });

  it('9. Student cannot approve another booking (403 Forbidden)', async () => {
    const booking = await Booking.create({
      resource: testResource._id,
      user: studentUser1._id,
      startTime: getFutureDate(2, 10),
      endTime: getFutureDate(2, 12),
      purpose: 'Pending Review',
      attendeeCount: 4,
      status: 'pending',
    });

    const res = await request(app)
      .patch(`/api/bookings/${booking._id}/status`)
      .set('Authorization', `Bearer ${studentToken2}`)
      .send({ status: 'confirmed' });

    expect(res.status).toBe(403);
  });

  it('10. Student cannot access or cancel another student booking', async () => {
    const booking = await Booking.create({
      resource: testResource._id,
      user: studentUser1._id,
      startTime: getFutureDate(2, 10),
      endTime: getFutureDate(2, 12),
      purpose: 'Alex Chen Private Study',
      attendeeCount: 1,
      status: 'confirmed',
    });

    // Student 2 attempts to cancel Student 1's booking
    const res = await request(app)
      .post(`/api/bookings/${booking._id}/cancel`)
      .set('Authorization', `Bearer ${studentToken2}`)
      .send({ reason: 'Malicious cancellation attempt' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not authorized to cancel/i);
  });

  it('11. Simultaneous requests cannot create conflicting active reservations (Concurrency Test)', async () => {
    const start = getFutureDate(4, 10, 0);
    const end = getFutureDate(4, 12, 0);

    // Fire two simultaneous requests for the exact same slot
    const req1 = request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${studentToken1}`)
      .send({
        resourceId: testResource._id.toString(),
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        purpose: 'Concurrent Request Alpha',
        attendeeCount: 2,
      });

    const req2 = request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${studentToken2}`)
      .send({
        resourceId: testResource._id.toString(),
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        purpose: 'Concurrent Request Beta',
        attendeeCount: 2,
      });

    const [res1, res2] = await Promise.all([req1, req2]);

    const statuses = [res1.status, res2.status].sort();
    // Exactly one should succeed (201) and the other should be rejected with conflict (409)
    expect(statuses).toEqual([201, 409]);

    // Verify in database that exactly ONE booking was stored for this interval
    const totalBookingsForSlot = await Booking.countDocuments({
      resource: testResource._id,
      startTime: start,
      endTime: end,
    });
    expect(totalBookingsForSlot).toBe(1);
  });
});

// ==========================================
// 5. NOTIFICATIONS & REPORTS
// ==========================================
describe('Notifications & Analytics Reports', () => {
  it('User receives in-app notifications on booking events', async () => {
    const notif = await Notification.create({
      recipient: studentUser1._id,
      title: 'Booking Confirmed!',
      message: 'Your lab session is ready.',
      type: 'booking_confirmed',
    });

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentToken1}`);

    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n) => n._id === notif._id.toString())).toBe(true);

    // Student 2 should not see Student 1's notifications
    const res2 = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${studentToken2}`);

    expect(res2.body.notifications.some((n) => n._id === notif._id.toString())).toBe(false);
  });

  it('GET /api/reports/bookings?format=csv returns CSV file download', async () => {
    const res = await request(app)
      .get('/api/reports/bookings?format=csv')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('Booking ID,Resource Name');
  });
});

// ==========================================
// 6. FRONTEND COMPONENT & UI INTERACTION TESTS
// ==========================================
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App, { AuthProvider, ToastProvider } from '../src/App.jsx';

describe('Frontend React UI & Component Tests', () => {
  it('Renders application brand and header correctly', async () => {
    render(
      React.createElement(MemoryRouter, { initialEntries: ['/'] },
        React.createElement(App)
      )
    );

    expect(screen.getByText(/CampusReserve/i)).toBeDefined();
    expect(screen.getByText(/Smart Resource Hub/i)).toBeDefined();
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
  });

  it('Renders navigation links for unauthenticated guest', async () => {
    render(
      React.createElement(MemoryRouter, { initialEntries: ['/'] },
        React.createElement(App)
      )
    );

    expect(screen.getAllByText(/Overview/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Explore Resources/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Availability Calendar/i).length).toBeGreaterThan(0);
  });

  it('Renders Settings page with Theme switcher and Demo credentials', async () => {
    render(
      React.createElement(MemoryRouter, { initialEntries: ['/settings'] },
        React.createElement(App)
      )
    );

    expect(screen.getByText(/Interface Preferences/i)).toBeDefined();
    expect(screen.getByText(/Evaluation Demo Account Switcher/i)).toBeDefined();
    expect(screen.getByText(/Switch to Student/i)).toBeDefined();
    expect(screen.getByText(/Switch to Admin/i)).toBeDefined();
  });

  it('Renders sign in button when user is not logged in', async () => {
    render(
      React.createElement(MemoryRouter, { initialEntries: ['/'] },
        React.createElement(App)
      )
    );

    const signInButtons = screen.getAllByText(/Sign In/i);
    expect(signInButtons.length).toBeGreaterThan(0);
  });
});

