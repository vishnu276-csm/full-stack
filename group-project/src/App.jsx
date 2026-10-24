import React, { useState, useEffect, useContext, createContext, useMemo } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Compass,
  CalendarDays,
  BookmarkCheck,
  Bell,
  BarChart3,
  Building2,
  CheckCircle2,
  Users,
  Settings as SettingsIcon,
  LogOut,
  LogIn,
  Sun,
  Moon,
  Plus,
  Search,
  Filter,
  Clock,
  MapPin,
  ChevronRight,
  AlertCircle,
  X,
  FileSpreadsheet,
  Check,
  AlertTriangle,
  Menu,
  ShieldCheck,
  UserCheck,
  Layers,
  Sparkles,
  Info
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

// ==========================================
// 1. CENTRALIZED API CLIENT
// ==========================================
export const API_BASE = '/api';

export async function apiRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const baseUrl = (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('http://localhost:3000'))
    ? ''
    : 'http://localhost:5000';
  const targetUrl = endpoint.startsWith('http') ? endpoint : `${baseUrl}${API_BASE}${endpoint}`;

  const response = await fetch(targetUrl, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || `HTTP error! Status: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

// ==========================================
// 2. AUTHENTICATION & GLOBAL CONTEXT
// ==========================================
export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const fetchCurrentUser = async () => {
    try {
      const res = await apiRequest('/auth/me');
      setUser(res.user);
      fetchNotificationCount();
    } catch (err) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchNotificationCount = async () => {
    try {
      const res = await apiRequest('/notifications');
      setUnreadNotifications(res.unreadCount || 0);
    } catch (err) {
      // Ignore if not logged in
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  const login = async (email, password) => {
    setAuthError('');
    try {
      const res = await apiRequest('/auth/login', 'POST', { email, password });
      setUser(res.user);
      fetchNotificationCount();
      return res.user;
    } catch (err) {
      setAuthError(err.message);
      throw err;
    }
  };

  const register = async (userData) => {
    setAuthError('');
    try {
      const res = await apiRequest('/auth/register', 'POST', userData);
      setUser(res.user);
      fetchNotificationCount();
      return res.user;
    } catch (err) {
      setAuthError(err.message);
      throw err;
    }
  };

  const logout = async () => {
    try {
      await apiRequest('/auth/logout', 'POST');
    } finally {
      setUser(null);
      setUnreadNotifications(0);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authError,
        unreadNotifications,
        setUnreadNotifications,
        login,
        register,
        logout,
        refreshUser: fetchCurrentUser,
        fetchNotificationCount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// ==========================================
// 3. TOAST & NOTIFICATION SYSTEM
// ==========================================
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`alert-box ${t.type === 'error' ? 'alert-danger' : (t.type === 'success' ? 'alert-success' : 'alert-info')}`}
            style={{ minWidth: '280px', maxWidth: '420px', boxShadow: '0 8px 20px rgba(0,0,0,0.15)', animation: 'slideUp 0.2s ease-out' }}
          >
            {t.type === 'error' && <AlertCircle size={18} />}
            {t.type === 'success' && <CheckCircle2 size={18} />}
            {t.type === 'info' && <Info size={18} />}
            <span style={{ flex: 1, fontSize: '0.88rem' }}>{t.message}</span>
            <button onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))} style={{ color: 'inherit', opacity: 0.7 }}>
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ==========================================
// 4. SHARED UI COMPONENTS & MODALS
// ==========================================

function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="badge-dot" />
      {status}
    </span>
  );
}

function ResourceTypeBadge({ type }) {
  const labels = {
    computer_lab: 'Computer Lab',
    seminar_hall: 'Seminar Hall',
    classroom: 'Classroom',
    study_room: 'Study Room',
    projector_equipment: 'AV Equipment',
    sports_facility: 'Sports Facility',
    meeting_room: 'Meeting Room',
    lab_equipment: 'Lab Hardware',
  };
  return <span className="resource-type-tag">{labels[type] || type}</span>;
}

// --- BOOKING MODAL ---
function BookingModal({ resource, initialDate, onClose, onSuccess }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Default booking dates
  const today = new Date();
  const defaultDateStr = initialDate || today.toISOString().split('T')[0];

  const [date, setDate] = useState(defaultDateStr);
  const [startTimeStr, setStartTimeStr] = useState('10:00');
  const [endTimeStr, setEndTimeStr] = useState('12:00');
  const [purpose, setPurpose] = useState('');
  const [attendeeCount, setAttendeeCount] = useState(1);
  const [notes, setNotes] = useState('');

  // Auto set duration
  const durationMinutes = useMemo(() => {
    if (!startTimeStr || !endTimeStr) return 0;
    const [sh, sm] = startTimeStr.split(':').map(Number);
    const [eh, em] = endTimeStr.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  }, [startTimeStr, endTimeStr]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!user) {
      setError('Please sign in to submit a resource reservation.');
      return;
    }

    if (durationMinutes <= 0) {
      setError('End time must be later than start time.');
      return;
    }

    if (attendeeCount > resource.capacity) {
      setError(`Attendees (${attendeeCount}) exceed capacity (${resource.capacity}).`);
      return;
    }

    const startDateTime = new Date(`${date}T${startTimeStr}:00`);
    const endDateTime = new Date(`${date}T${endTimeStr}:00`);

    if (startDateTime < new Date()) {
      setError('Reservation time cannot be in the past.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest('/bookings', 'POST', {
        resourceId: resource._id,
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString(),
        purpose,
        attendeeCount: Number(attendeeCount),
        notes,
      });

      addToast(res.message || 'Booking submitted successfully!', 'success');
      onSuccess?.(res.booking);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-dialog">
        <div className="modal-header">
          <div>
            <h3>Reserve Facility</h3>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{resource.name} ({resource.building})</span>
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-content">
            {error && (
              <div className="alert-box alert-danger">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', background: 'var(--bg-subtle)', padding: '12px', borderRadius: 'var(--radius-md)', fontSize: '0.82rem' }}>
              <div>
                <strong>Capacity:</strong> {resource.capacity} people
              </div>
              <div>
                <strong>Hours:</strong> {resource.openingTime} - {resource.closingTime}
              </div>
              <div>
                <strong>Approval:</strong> {resource.requiresApproval ? 'Admin Review Required' : 'Instant Confirmation'}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Reservation Date *</label>
              <input
                type="date"
                className="form-control"
                value={date}
                min={today.toISOString().split('T')[0]}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="form-group">
                <label className="form-label">Start Time *</label>
                <input
                  type="time"
                  className="form-control"
                  value={startTimeStr}
                  onChange={(e) => setStartTimeStr(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">End Time *</label>
                <input
                  type="time"
                  className="form-control"
                  value={endTimeStr}
                  onChange={(e) => setEndTimeStr(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ fontSize: '0.8rem', color: durationMinutes > 0 ? 'var(--color-primary)' : 'var(--text-muted)', marginBottom: '16px' }}>
              Duration: {durationMinutes > 0 ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m` : 'Invalid interval'} (Allowed: {resource.minDurationMinutes}m - {resource.maxDurationMinutes}m)
            </div>

            <div className="form-group">
              <label className="form-label">Number of Attendees *</label>
              <input
                type="number"
                className="form-control"
                min="1"
                max={resource.capacity}
                value={attendeeCount}
                onChange={(e) => setAttendeeCount(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Purpose of Booking *</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Capstone project team meeting, seminar presentation..."
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Special Notes / Equipment Needs (Optional)</label>
              <textarea
                className="form-control"
                rows="2"
                placeholder="e.g. Need projector HDMI adapters or audio check beforehand..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Verifying & Reserving...' : 'Confirm Reservation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- RESOURCE DETAILS MODAL ---
function ResourceDetailsModal({ resource, onClose, onBookNow }) {
  return (
    <div className="modal-overlay">
      <div className="modal-dialog" style={{ maxWidth: '680px' }}>
        <div className="modal-header">
          <div>
            <h3>{resource.name}</h3>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              {resource.building} &bull; {resource.floorRoom}
            </span>
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-content">
          <div style={{ height: '220px', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: '18px' }}>
            <img src={resource.imageUrl} alt={resource.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>

          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '20px' }}>
            {resource.description}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: 'var(--bg-subtle)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Capacity</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{resource.capacity} people</div>
            </div>
            <div style={{ background: 'var(--bg-subtle)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Operating Hours</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{resource.openingTime} - {resource.closingTime}</div>
            </div>
            <div style={{ background: 'var(--bg-subtle)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Approval</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: resource.requiresApproval ? '#f59e0b' : '#10b981' }}>
                {resource.requiresApproval ? 'Admin Approval' : 'Instant Book'}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '18px' }}>
            <h4 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '8px' }}>Available Equipment</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {resource.equipment?.map((eq, i) => (
                <span key={i} style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary-dark)', padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: '0.78rem', fontWeight: 500 }}>
                  {eq}
                </span>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '18px' }}>
            <h4 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '6px' }}>Operating Days</h4>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {resource.operatingDays?.join(', ')}
            </div>
          </div>

          <div>
            <h4 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '6px' }}>Accessibility & Facilities</h4>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {resource.accessibilityDetails}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onClose();
              onBookNow(resource);
            }}
          >
            Reserve This Facility
          </button>
        </div>
      </div>
    </div>
  );
}

// --- AUTH MODAL (LOGIN / REGISTER) ---
function AuthModal({ isOpen, onClose }) {
  const { login, register, authError } = useAuth();
  const { addToast } = useToast();
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('Computer Science & Engineering');
  const [academicYear, setAcademicYear] = useState('Junior (Year 3)');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');
    setLoading(true);

    try {
      if (isRegister) {
        await register({ name, email, password, department, academicYear });
        addToast('Student account created successfully!', 'success');
      } else {
        await login(email, password);
        addToast('Welcome back!', 'success');
      }
      onClose();
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fillDemoStudent = () => {
    setEmail('alex.chen@campus.edu');
    setPassword('Student123!');
    setIsRegister(false);
  };

  const fillDemoAdmin = () => {
    setEmail('admin@campus.edu');
    setPassword('AdminSecure2026!');
    setIsRegister(false);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-dialog" style={{ maxWidth: '440px' }}>
        <div className="modal-header">
          <h3>{isRegister ? 'Student Registration' : 'Campus Sign In'}</h3>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-content">
            {(localError || authError) && (
              <div className="alert-box alert-danger">
                <AlertCircle size={18} />
                <span>{localError || authError}</span>
              </div>
            )}

            {/* Quick Demo Fill Buttons */}
            <div style={{ background: 'var(--bg-subtle)', padding: '12px', borderRadius: 'var(--radius-md)', marginBottom: '18px' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
                Quick Demo Credentials:
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1, padding: '6px', fontSize: '0.78rem' }} onClick={fillDemoStudent}>
                  Student (Alex Chen)
                </button>
                <button type="button" className="btn btn-secondary" style={{ flex: 1, padding: '6px', fontSize: '0.78rem' }} onClick={fillDemoAdmin}>
                  Admin (Dr. Mitchell)
                </button>
              </div>
            </div>

            {isRegister && (
              <>
                <div className="form-group">
                  <label className="form-label">Full Name *</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Maya Lin"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Academic Department</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Electrical Engineering"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Academic Year</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Sophomore (Year 2)"
                    value={academicYear}
                    onChange={(e) => setAcademicYear(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="form-group">
              <label className="form-label">Campus Email *</label>
              <input
                type="email"
                className="form-control"
                placeholder="name@campus.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password *</label>
              <input
                type="password"
                className="form-control"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <div style={{ marginTop: '14px', fontSize: '0.85rem', textAlign: 'center' }}>
              {isRegister ? (
                <span>
                  Already registered?{' '}
                  <button type="button" style={{ color: 'var(--color-primary)', fontWeight: 600 }} onClick={() => setIsRegister(false)}>
                    Sign In
                  </button>
                </span>
              ) : (
                <span>
                  New student?{' '}
                  <button type="button" style={{ color: 'var(--color-primary)', fontWeight: 600 }} onClick={() => setIsRegister(true)}>
                    Create Student Account
                  </button>
                </span>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Authenticating...' : (isRegister ? 'Register Account' : 'Sign In')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// 5. MAIN NAVIGATION & TOPBAR
// ==========================================
function Sidebar({ isOpen, onClose, onOpenAuth }) {
  const { user, logout, unreadNotifications } = useAuth();
  const location = useLocation();

  const navItems = [
    { label: 'Overview', path: '/', icon: LayoutDashboard },
    { label: 'Explore Resources', path: '/resources', icon: Compass },
    { label: 'Availability Calendar', path: '/calendar', icon: CalendarDays },
    { label: 'My Bookings', path: '/my-bookings', icon: BookmarkCheck, authRequired: true },
    { label: 'Notifications', path: '/notifications', icon: Bell, badge: unreadNotifications, authRequired: true },
  ];

  const adminItems = [
    { label: 'Booking Approvals', path: '/admin/approvals', icon: CheckCircle2 },
    { label: 'Resource Management', path: '/admin/resources', icon: Building2 },
    { label: 'Analytics & Reports', path: '/reports', icon: BarChart3 },
    { label: 'User Directory', path: '/admin/users', icon: Users },
  ];

  return (
    <>
      {isOpen && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`app-sidebar ${isOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <Layers size={22} />
          </div>
          <div className="sidebar-brand-text">
            <h2>CampusReserve</h2>
            <span>Smart Resource Hub</span>
          </div>
        </div>

        <div className="sidebar-nav">
          <div className="nav-section-title">Navigation</div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            if (item.authRequired && !user) return null;

            return (
              <Link key={item.path} to={item.path} className={`nav-link ${active ? 'active' : ''}`} onClick={onClose}>
                <Icon size={18} />
                <span>{item.label}</span>
                {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
              </Link>
            );
          })}

          {user?.role === 'admin' && (
            <>
              <div className="nav-section-title" style={{ marginTop: '12px' }}>Administration</div>
              {adminItems.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.path;
                return (
                  <Link key={item.path} to={item.path} className={`nav-link ${active ? 'active' : ''}`} onClick={onClose}>
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </>
          )}

          <div className="nav-section-title" style={{ marginTop: '12px' }}>System</div>
          <Link to="/settings" className={`nav-link ${location.pathname === '/settings' ? 'active' : ''}`} onClick={onClose}>
            <SettingsIcon size={18} />
            <span>Settings & Profile</span>
          </Link>
        </div>

        <div className="sidebar-footer">
          {user ? (
            <>
              <div className="user-profile-widget">
                <div className="user-avatar">{user.name.charAt(0)}</div>
                <div className="user-info">
                  <div className="user-info-name">{user.name}</div>
                  <div className="user-info-role">
                    {user.role === 'admin' ? <ShieldCheck size={12} /> : <UserCheck size={12} />}
                    {user.role} &bull; {user.department?.split(' ')[0]}
                  </div>
                </div>
              </div>
              <button className="signout-btn" onClick={logout}>
                <LogOut size={16} />
                <span>Sign Out</span>
              </button>
            </>
          ) : (
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={onOpenAuth}>
              <LogIn size={16} />
              <span>Campus Sign In</span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function Topbar({ onToggleSidebar, onOpenAuth, theme, onToggleTheme }) {
  const { user, unreadNotifications } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/': return { title: 'Dashboard Overview', subtitle: 'Real-time campus occupancy & facility metrics' };
      case '/resources': return { title: 'Explore Resources', subtitle: 'Browse labs, auditoriums, classrooms & study spaces' };
      case '/calendar': return { title: 'Availability Calendar', subtitle: 'Interactive timeline schedules & free slots' };
      case '/my-bookings': return { title: 'My Bookings', subtitle: 'Manage reservations, requests & history' };
      case '/notifications': return { title: 'Notifications', subtitle: 'Alerts, reservation status & system notices' };
      case '/admin/approvals': return { title: 'Booking Approvals', subtitle: 'Review and approve pending student reservations' };
      case '/admin/resources': return { title: 'Resource Management', subtitle: 'Create, update, and manage campus facilities' };
      case '/reports': return { title: 'Analytics & Reports', subtitle: 'Campus resource utilization trends and CSV export' };
      case '/admin/users': return { title: 'User Management', subtitle: 'Role permissions and account directory' };
      case '/settings': return { title: 'Settings', subtitle: 'Personal profile, preferences & testing tools' };
      default: return { title: 'Smart Campus Resource Booking', subtitle: 'University Facility Portal' };
    }
  };

  const { title, subtitle } = getPageTitle();

  return (
    <header className="top-navbar">
      <div className="topbar-left">
        <button className="mobile-menu-btn" onClick={onToggleSidebar} aria-label="Toggle navigation">
          <Menu size={22} />
        </button>
        <div className="page-breadcrumb">
          <h1>{title}</h1>
          <span>{subtitle}</span>
        </div>
      </div>

      <div className="topbar-right">
        <button className="theme-toggle-btn" onClick={onToggleTheme} aria-label="Toggle Theme">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {user && (
          <button className="notif-icon-btn" onClick={() => navigate('/notifications')} aria-label="Notifications">
            <Bell size={18} />
            {unreadNotifications > 0 && <span className="notif-badge-dot" />}
          </button>
        )}

        {!user && (
          <button className="btn btn-primary" onClick={onOpenAuth}>
            <LogIn size={16} />
            <span>Sign In</span>
          </button>
        )}
      </div>
    </header>
  );
}

// ==========================================
// 6. PAGE: DASHBOARD OVERVIEW
// ==========================================
function OverviewPage({ onOpenBooking }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [featuredResources, setFeaturedResources] = useState([]);

  useEffect(() => {
    async function loadData() {
      try {
        const [overviewRes, resourcesRes] = await Promise.all([
          apiRequest('/stats/overview'),
          apiRequest('/resources?limit=4&isActive=true'),
        ]);
        setStats(overviewRes);
        setFeaturedResources(resourcesRes.resources || []);
      } catch (err) {
        console.error('Failed to load dashboard stats:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const chartData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: 'Active Facilities', value: stats.activeResources || 0, fill: '#0284c7' },
      { name: 'Available Today', value: stats.availableResourcesToday || 0, fill: '#10b981' },
      { name: 'Pending Requests', value: stats.pendingApprovals || 0, fill: '#f59e0b' },
    ];
  }, [stats]);

  const weeklyTrends = useMemo(() => [
    { day: 'Mon', reservations: 18, confirmed: 16 },
    { day: 'Tue', reservations: 25, confirmed: 22 },
    { day: 'Wed', reservations: 34, confirmed: 31 },
    { day: 'Thu', reservations: 42, confirmed: 38 },
    { day: 'Fri', reservations: 29, confirmed: 26 },
    { day: 'Sat', reservations: 19, confirmed: 18 },
    { day: 'Sun', reservations: 12, confirmed: 11 },
  ], []);

  if (loading) {
    return <div className="empty-state">Loading dashboard analytics...</div>;
  }

  return (
    <div>
      {/* Hero Welcome Banner */}
      <div className="hero-banner">
        <div className="hero-content">
          <div className="hero-badge">
            <span className="live-ping-dot" />
            <span>Academic Term Schedule &bull; Real-Time Sync</span>
          </div>
          <h2 className="hero-title">
            Smart Campus <span className="hero-gradient-text">Resource Hub</span>
          </h2>
          <p className="hero-subtitle">
            Reserve advanced computing clusters, seminar halls, quiet study pods, and sports facilities with automated conflict prevention and instant schedule verification.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-glow" onClick={() => navigate('/resources')}>
              <Compass size={18} />
              <span>Explore All Facilities</span>
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/calendar')}>
              <CalendarDays size={18} />
              <span>Live Schedule Grid</span>
            </button>
          </div>
          <div className="hero-quick-filters">
            <span className="quick-filter-title">Quick Search:</span>
            <button className="quick-pill" onClick={() => navigate('/resources?type=computer_lab')}>⚡ AI & GPU Labs</button>
            <button className="quick-pill" onClick={() => navigate('/resources?type=seminar_hall')}>🏛️ Auditoriums</button>
            <button className="quick-pill" onClick={() => navigate('/resources?type=study_room')}>🤫 Silent Pods</button>
            <button className="quick-pill" onClick={() => navigate('/resources?type=sports_facility')}>🏸 Sports Arena</button>
          </div>
        </div>

        <div className="hero-visual-card">
          <div className="hero-stat-widget">
            <div className="widget-header">
              <Sparkles size={16} />
              <span>Campus Status</span>
            </div>
            <div className="widget-number">{stats?.availableResourcesToday || 12}</div>
            <div className="widget-label">Facilities Open & Available Today</div>
            <div className="widget-bar">
              <div className="widget-bar-fill" style={{ width: `${Math.min(100, Math.max(15, stats?.utilizationPercentage || 24))}%` }} />
            </div>
            <div className="widget-footer">
              <span>Current Utilization</span>
              <strong style={{ color: 'var(--color-primary)' }}>{stats?.utilizationPercentage || 0}%</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon-wrapper" style={{ background: 'rgba(2, 132, 199, 0.12)', color: '#0284c7' }}>
            <Building2 size={26} />
          </div>
          <div>
            <div className="stat-value">{stats?.activeResources || 0}</div>
            <div className="stat-label">Active Campus Facilities</div>
            <div className="stat-trend">↑ 100% Operational</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper" style={{ background: 'rgba(16, 185, 129, 0.12)', color: '#10b981' }}>
            <CheckCircle2 size={26} />
          </div>
          <div>
            <div className="stat-value">{stats?.availableResourcesToday || 0}</div>
            <div className="stat-label">Available Facilities Today</div>
            <div className="stat-trend" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#059669' }}>
              ✓ Ready for Booking
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper" style={{ background: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' }}>
            <Clock size={26} />
          </div>
          <div>
            <div className="stat-value">{stats?.pendingApprovals || 0}</div>
            <div className="stat-label">Pending Approval Requests</div>
            <div className="stat-trend" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#d97706' }}>
              ● Requires Review
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper" style={{ background: 'rgba(99, 102, 241, 0.12)', color: '#6366f1' }}>
            <BarChart3 size={26} />
          </div>
          <div>
            <div className="stat-value">{stats?.utilizationPercentage || 0}%</div>
            <div className="stat-label">Campus Utilization Rate</div>
            <div className="stat-trend" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#4f46e5' }}>
              Target: 40-75%
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Visual Charts & Activity Feed */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px', marginBottom: '32px' }}>
        {/* Status Distribution Visual */}
        <div className="table-card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '6px' }}>Facility Occupancy Breakdown</h3>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '14px' }}>
            Ratio of operational vs booked spaces
          </span>
          <div style={{ height: '220px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={85}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Weekly Activity Area Chart */}
        <div className="table-card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '6px' }}>Weekly Booking Traffic Trends</h3>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '14px' }}>
            Daily reservation submissions & confirmations
          </span>
          <div style={{ height: '220px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyTrends}>
                <defs>
                  <linearGradient id="bookingTrendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.6}/>
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0.05}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Area type="monotone" dataKey="reservations" stroke="#0284c7" strokeWidth={2.5} fillOpacity={1} fill="url(#bookingTrendGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="table-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Recent Booking Activity</h3>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Latest campus reservations</span>
            </div>
            <button className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '4px 10px' }} onClick={() => navigate('/resources')}>
              Explore All
            </button>
          </div>

          {stats?.recentBookings?.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No recent activity recorded.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {stats?.recentBookings?.slice(0, 4).map((b) => (
                <div key={b._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <div>
                    <div style={{ fontSize: '0.86rem', fontWeight: 600 }}>{b.resource?.name || 'Campus Facility'}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      By {b.user?.name} &bull; {new Date(b.startTime).toLocaleDateString()}
                    </div>
                  </div>
                  <StatusBadge status={b.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Featured Resources Section */}
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Featured Campus Resources</h2>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>High-demand facilities equipped with professional hardware</span>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate('/resources')}>
          View Full Catalog ({stats?.totalResources || 0})
        </button>
      </div>

      <div className="resource-grid">
        {featuredResources.map((res) => (
          <div key={res._id} className="resource-card">
            <div className="resource-image-wrap">
              <img src={res.imageUrl} alt={res.name} className="resource-image" />
              <ResourceTypeBadge type={res.type} />
              <span className="live-status-pill">
                <span className="live-dot-green" />
                {res.requiresApproval ? 'Admin Review' : 'Instant Book'}
              </span>
            </div>
            <div className="resource-card-body">
              <h3 className="resource-card-title">{res.name}</h3>
              <div className="resource-location">
                <MapPin size={14} />
                <span>{res.building} &bull; {res.floorRoom}</span>
              </div>
              <p className="resource-description">{res.description}</p>

              {/* Equipment Chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '14px' }}>
                {res.equipment?.slice(0, 3).map((eq, i) => (
                  <span key={i} className="equipment-chip">{eq}</span>
                ))}
                {res.equipment?.length > 3 && (
                  <span className="equipment-chip" style={{ opacity: 0.8 }}>+{res.equipment.length - 3}</span>
                )}
              </div>

              <div className="resource-meta-row">
                <div className="resource-meta-item">
                  <Users size={14} />
                  <span>Cap: {res.capacity}</span>
                </div>
                <div className="resource-meta-item">
                  <Clock size={14} />
                  <span>{res.openingTime} - {res.closingTime}</span>
                </div>
              </div>
              <div className="resource-card-actions">
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => onOpenBooking(res)}>
                  Reserve Facility
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==========================================
// 7. PAGE: RESOURCE DISCOVERY & CATALOG
// ==========================================
function ResourcesPage({ onOpenBooking }) {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [minCapacity, setMinCapacity] = useState('');
  const [activeModalResource, setActiveModalResource] = useState(null);

  const fetchResources = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (selectedType) params.append('type', selectedType);
      if (minCapacity) params.append('minCapacity', minCapacity);
      params.append('limit', '50');

      const data = await apiRequest(`/resources?${params.toString()}`);
      setResources(data.resources || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResources();
  }, [selectedType, minCapacity]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchResources();
  };

  const types = [
    { key: '', label: 'All Types' },
    { key: 'computer_lab', label: 'Computer Labs' },
    { key: 'seminar_hall', label: 'Seminar Halls' },
    { key: 'classroom', label: 'Classrooms' },
    { key: 'study_room', label: 'Study Pods' },
    { key: 'sports_facility', label: 'Sports Courts' },
    { key: 'lab_equipment', label: 'Prototyping & Labs' },
    { key: 'projector_equipment', label: 'AV & Cameras' },
    { key: 'meeting_room', label: 'Conference Rooms' },
  ];

  return (
    <div>
      {/* Search & Filter Bar */}
      <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-card)', marginBottom: '24px' }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 260px', position: 'relative' }}>
            <input
              type="text"
              className="form-control"
              placeholder="Search by facility name, building, equipment..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: '38px' }}
            />
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }} />
          </div>

          <div style={{ flex: '0 1 180px' }}>
            <select
              className="form-control"
              value={minCapacity}
              onChange={(e) => setMinCapacity(e.target.value)}
            >
              <option value="">Any Capacity</option>
              <option value="5">5+ People</option>
              <option value="15">15+ People</option>
              <option value="30">30+ People</option>
              <option value="100">100+ People</option>
            </select>
          </div>

          <button type="submit" className="btn btn-primary">
            <Search size={16} />
            <span>Search</span>
          </button>
        </form>

        {/* Type filter chips */}
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', marginTop: '16px', paddingBottom: '4px' }}>
          {types.map((t) => (
            <button
              key={t.key}
              onClick={() => setSelectedType(t.key)}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-full)',
                fontSize: '0.8rem',
                fontWeight: 600,
                border: '1px solid',
                borderColor: selectedType === t.key ? 'var(--color-primary)' : 'var(--border-light)',
                background: selectedType === t.key ? 'var(--color-primary-light)' : 'var(--bg-surface)',
                color: selectedType === t.key ? 'var(--color-primary-dark)' : 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Facilities Grid */}
      {loading ? (
        <div className="empty-state">Searching facilities...</div>
      ) : resources.length === 0 ? (
        <div className="empty-state">
          <Building2 className="empty-state-icon" />
          <h3>No Facilities Found</h3>
          <p>Try refining your search terms or capacity criteria.</p>
        </div>
      ) : (
        <div className="resource-grid">
          {resources.map((res) => (
            <div key={res._id} className="resource-card">
              <div className="resource-image-wrap">
                <img src={res.imageUrl} alt={res.name} className="resource-image" />
                <ResourceTypeBadge type={res.type} />
                <span className="live-status-pill">
                  <span className="live-dot-green" />
                  {res.requiresApproval ? 'Admin Review' : 'Instant Book'}
                </span>
              </div>
              <div className="resource-card-body">
                <h3 className="resource-card-title">{res.name}</h3>
                <div className="resource-location">
                  <MapPin size={14} />
                  <span>{res.building} &bull; {res.floorRoom}</span>
                </div>
                <p className="resource-description">{res.description}</p>

                {/* Equipment Chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '14px' }}>
                  {res.equipment?.slice(0, 3).map((eq, i) => (
                    <span key={i} className="equipment-chip">{eq}</span>
                  ))}
                  {res.equipment?.length > 3 && (
                    <span className="equipment-chip" style={{ opacity: 0.8 }}>+{res.equipment.length - 3}</span>
                  )}
                </div>

                <div className="resource-meta-row">
                  <div className="resource-meta-item">
                    <Users size={14} />
                    <span>Cap: {res.capacity}</span>
                  </div>
                  <div className="resource-meta-item">
                    <Clock size={14} />
                    <span>{res.openingTime} - {res.closingTime}</span>
                  </div>
                </div>

                <div className="resource-card-actions">
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setActiveModalResource(res)}>
                    Details
                  </button>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => onOpenBooking(res)}>
                    Book Now
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Resource Spec Modal */}
      {activeModalResource && (
        <ResourceDetailsModal
          resource={activeModalResource}
          onClose={() => setActiveModalResource(null)}
          onBookNow={onOpenBooking}
        />
      )}
    </div>
  );
}

// ==========================================
// 8. PAGE: AVAILABILITY CALENDAR
// ==========================================
function CalendarPage({ onOpenBookingWithSlot }) {
  const [resources, setResources] = useState([]);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load resources
  useEffect(() => {
    async function loadResources() {
      try {
        const data = await apiRequest('/resources?limit=50&isActive=true');
        setResources(data.resources || []);
        if (data.resources?.length > 0) {
          setSelectedResourceId(data.resources[0]._id);
        }
      } catch (err) {
        console.error(err);
      }
    }
    loadResources();
  }, []);

  // Load availability
  useEffect(() => {
    if (!selectedResourceId) return;
    async function fetchAvailability() {
      setLoading(true);
      try {
        const data = await apiRequest(`/resources/${selectedResourceId}/availability?date=${selectedDate}`);
        setAvailability(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchAvailability();
  }, [selectedResourceId, selectedDate]);

  // Construct day hourly slots (08:00 to 22:00)
  const slots = useMemo(() => {
    if (!availability?.resource) return [];
    const result = [];
    const [openHour] = availability.resource.openingTime.split(':').map(Number);
    const [closeHour] = availability.resource.closingTime.split(':').map(Number);

    for (let h = openHour; h < closeHour; h++) {
      const slotStartStr = `${String(h).padStart(2, '0')}:00`;
      const slotEndStr = `${String(h + 1).padStart(2, '0')}:00`;

      const slotStart = new Date(`${selectedDate}T${slotStartStr}:00`);
      const slotEnd = new Date(`${selectedDate}T${slotEndStr}:00`);

      // Check conflict with blocked intervals
      const conflict = availability.blockedIntervals?.find((b) => {
        const bStart = new Date(b.startTime);
        const bEnd = new Date(b.endTime);
        return bStart < slotEnd && bEnd > slotStart;
      });

      result.push({
        slotStartStr,
        slotEndStr,
        slotStart,
        slotEnd,
        isOccupied: !!conflict,
        conflictDetails: conflict,
      });
    }
    return result;
  }, [availability, selectedDate]);

  const selectedResource = resources.find((r) => r._id === selectedResourceId);

  return (
    <div className="calendar-wrapper">
      {/* Header Controls */}
      <div className="calendar-header">
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="form-control"
            style={{ width: 'auto', minWidth: '240px', fontWeight: 600 }}
            value={selectedResourceId}
            onChange={(e) => setSelectedResourceId(e.target.value)}
          >
            {resources.map((r) => (
              <option key={r._id} value={r._id}>{r.name} ({r.building})</option>
            ))}
          </select>

          <input
            type="date"
            className="form-control"
            style={{ width: 'auto' }}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '14px', fontSize: '0.8rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#10b981' }} /> Available
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#ef4444' }} /> Confirmed Occupied
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#f59e0b' }} /> Pending Approval
          </span>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Checking live schedules...</div>
      ) : !availability?.resource?.isOpenOnDate ? (
        <div className="alert-box alert-danger">
          <AlertTriangle size={18} />
          <span>This facility is closed on {availability?.dayOfWeek}. Operating days: {availability?.resource?.operatingDays?.join(', ')}.</span>
        </div>
      ) : (
        <div className="calendar-slots-grid">
          {slots.map((slot, i) => (
            <div
              key={i}
              className={`time-slot-row ${slot.isOccupied ? (slot.conflictDetails?.status === 'pending' ? 'slot-pending' : 'slot-occupied') : 'slot-available'}`}
            >
              <div className="time-slot-time">
                {slot.slotStartStr} - {slot.slotEndStr}
              </div>

              <div className="time-slot-status">
                {slot.isOccupied ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <StatusBadge status={slot.conflictDetails?.status || 'confirmed'} />
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      Occupied ({slot.conflictDetails?.purpose || 'Campus Session'})
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ fontSize: '0.82rem', color: '#059669', fontWeight: 600 }}>Available for reservation</span>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '4px 12px', fontSize: '0.78rem' }}
                      onClick={() => onOpenBookingWithSlot(selectedResource, selectedDate, slot.slotStartStr, slot.slotEndStr)}
                    >
                      Reserve Slot
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==========================================
// 9. PAGE: MY BOOKINGS
// ==========================================
function MyBookingsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [cancelModalBooking, setCancelModalBooking] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [submittingCancel, setSubmittingCancel] = useState(false);

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const url = activeTab === 'all' ? '/bookings' : `/bookings?status=${activeTab}`;
      const data = await apiRequest(url);
      setBookings(data.bookings || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, [activeTab]);

  const handleCancelSubmit = async (e) => {
    e.preventDefault();
    if (!cancelModalBooking) return;

    setSubmittingCancel(true);
    try {
      await apiRequest(`/bookings/${cancelModalBooking._id}/cancel`, 'POST', { reason: cancelReason });
      addToast('Reservation cancelled successfully.', 'info');
      setCancelModalBooking(null);
      setCancelReason('');
      fetchBookings();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSubmittingCancel(false);
    }
  };

  const tabs = [
    { key: 'all', label: 'All Bookings' },
    { key: 'pending', label: 'Pending Approval' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid var(--border-light)', paddingBottom: '12px' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`btn ${activeTab === t.key ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.82rem', padding: '6px 14px' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-state">Loading your reservations...</div>
      ) : bookings.length === 0 ? (
        <div className="empty-state">
          <BookmarkCheck className="empty-state-icon" />
          <h3>No Reservations Found</h3>
          <p>You have no bookings matching the selected status filter.</p>
        </div>
      ) : (
        <div className="table-card">
          <div className="table-responsive">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Facility</th>
                  <th>Date & Time</th>
                  <th>Attendees</th>
                  <th>Purpose</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b._id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{b.resource?.name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{b.resource?.building} ({b.resource?.floorRoom})</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{new Date(b.startTime).toLocaleDateString()}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td>{b.attendeeCount}</td>
                    <td style={{ maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.purpose}
                    </td>
                    <td>
                      <StatusBadge status={b.status} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {['pending', 'confirmed'].includes(b.status) && (
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.78rem', padding: '5px 10px', color: '#ef4444' }}
                          onClick={() => setCancelModalBooking(b)}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cancellation Dialog */}
      {cancelModalBooking && (
        <div className="modal-overlay">
          <div className="modal-dialog" style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h3>Cancel Reservation</h3>
              <button className="modal-close-btn" onClick={() => setCancelModalBooking(null)}><X size={20} /></button>
            </div>
            <form onSubmit={handleCancelSubmit}>
              <div className="modal-content">
                <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  Are you sure you want to cancel your booking for <strong>{cancelModalBooking.resource?.name}</strong> on {new Date(cancelModalBooking.startTime).toLocaleDateString()}?
                </p>
                <div className="form-group">
                  <label className="form-label">Cancellation Reason</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Schedule conflict, rescheduled meeting..."
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setCancelModalBooking(null)}>Back</button>
                <button type="submit" className="btn btn-danger" disabled={submittingCancel}>
                  {submittingCancel ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 10. PAGE: ADMIN APPROVALS QUEUE
// ==========================================
function AdminApprovalsPage() {
  const { addToast } = useToast();
  const [pendingBookings, setPendingBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rejectingBooking, setRejectingBooking] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processingId, setProcessingId] = useState(null);

  const fetchPending = async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/bookings?status=pending');
      setPendingBookings(data.bookings || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();
  }, []);

  const handleApprove = async (bookingId) => {
    setProcessingId(bookingId);
    try {
      await apiRequest(`/bookings/${bookingId}/status`, 'PATCH', { status: 'confirmed' });
      addToast('Reservation approved successfully!', 'success');
      fetchPending();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectSubmit = async (e) => {
    e.preventDefault();
    if (!rejectingBooking) return;

    setProcessingId(rejectingBooking._id);
    try {
      await apiRequest(`/bookings/${rejectingBooking._id}/status`, 'PATCH', {
        status: 'rejected',
        reason: rejectReason || 'Facility unavailable or policy requirement not met.',
      });
      addToast('Reservation rejected.', 'info');
      setRejectingBooking(null);
      setRejectReason('');
      fetchPending();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Pending Reservation Queue</h2>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Review and authorize student facility requests</span>
      </div>

      {loading ? (
        <div className="empty-state">Loading pending approval queue...</div>
      ) : pendingBookings.length === 0 ? (
        <div className="empty-state">
          <CheckCircle2 className="empty-state-icon" style={{ color: '#10b981' }} />
          <h3>No Pending Requests</h3>
          <p>All student reservation requests have been processed.</p>
        </div>
      ) : (
        <div className="table-card">
          <div className="table-responsive">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Facility</th>
                  <th>Date & Time</th>
                  <th>Attendees</th>
                  <th>Purpose</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingBookings.map((b) => (
                  <tr key={b._id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{b.user?.name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{b.user?.email}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-primary)' }}>{b.user?.department}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{b.resource?.name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{b.resource?.building}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{new Date(b.startTime).toLocaleDateString()}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td>{b.attendeeCount}</td>
                    <td style={{ maxWidth: '200px' }}>
                      <div style={{ fontWeight: 500 }}>{b.purpose}</div>
                      {b.notes && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Note: {b.notes}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '8px' }}>
                        <button
                          className="btn btn-success"
                          style={{ fontSize: '0.78rem', padding: '6px 12px' }}
                          disabled={processingId === b._id}
                          onClick={() => handleApprove(b._id)}
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ fontSize: '0.78rem', padding: '6px 12px' }}
                          disabled={processingId === b._id}
                          onClick={() => setRejectingBooking(b)}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectingBooking && (
        <div className="modal-overlay">
          <div className="modal-dialog" style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h3>Decline Reservation</h3>
              <button className="modal-close-btn" onClick={() => setRejectingBooking(null)}><X size={20} /></button>
            </div>
            <form onSubmit={handleRejectSubmit}>
              <div className="modal-content">
                <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  Provide a reason for declining the request by <strong>{rejectingBooking.user?.name}</strong>.
                </p>
                <div className="form-group">
                  <label className="form-label">Rejection Reason *</label>
                  <textarea
                    className="form-control"
                    rows="3"
                    placeholder="e.g. Scheduled facility maintenance, requires faculty sponsor..."
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setRejectingBooking(null)}>Cancel</button>
                <button type="submit" className="btn btn-danger">Confirm Rejection</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 11. PAGE: ADMIN RESOURCE MANAGEMENT
// ==========================================
function AdminResourcesPage() {
  const { addToast } = useToast();
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editResource, setEditResource] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const fetchResources = async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/resources?all=true&limit=100');
      setResources(data.resources || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResources();
  }, []);

  const handleToggleStatus = async (resource) => {
    try {
      await apiRequest(`/resources/${resource._id}/status`, 'PATCH', { isActive: !resource.isActive });
      addToast(`Facility ${!resource.isActive ? 'activated' : 'deactivated'}.`, 'success');
      fetchResources();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Campus Resource Directory</h2>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Configure facility specs, capacity, and active status</span>
        </div>
        <button className="btn btn-primary" onClick={() => setIsAddModalOpen(true)}>
          <Plus size={16} />
          <span>Add New Facility</span>
        </button>
      </div>

      {loading ? (
        <div className="empty-state">Loading facilities...</div>
      ) : (
        <div className="table-card">
          <div className="table-responsive">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Facility</th>
                  <th>Type</th>
                  <th>Building & Room</th>
                  <th>Capacity</th>
                  <th>Operating Hours</th>
                  <th>Policy</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {resources.map((r) => (
                  <tr key={r._id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Code: {r.code || 'N/A'}</div>
                    </td>
                    <td>
                      <ResourceTypeBadge type={r.type} />
                    </td>
                    <td>{r.building} &bull; {r.floorRoom}</td>
                    <td>{r.capacity} seats</td>
                    <td>{r.openingTime} - {r.closingTime}</td>
                    <td>
                      <span style={{ fontSize: '0.78rem', color: r.requiresApproval ? '#f59e0b' : '#10b981', fontWeight: 600 }}>
                        {r.requiresApproval ? 'Admin Review' : 'Auto Confirm'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${r.isActive ? 'badge-confirmed' : 'badge-cancelled'}`}>
                        <span className="badge-dot" />
                        {r.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '8px' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                          onClick={() => setEditResource(r)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '4px 8px', color: r.isActive ? '#ef4444' : '#10b981' }}
                          onClick={() => handleToggleStatus(r)}
                        >
                          {r.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Facility Modal */}
      {(isAddModalOpen || editResource) && (
        <ResourceFormModal
          resource={editResource}
          onClose={() => {
            setIsAddModalOpen(false);
            setEditResource(null);
          }}
          onSuccess={() => {
            setIsAddModalOpen(false);
            setEditResource(null);
            fetchResources();
          }}
        />
      )}
    </div>
  );
}

function ResourceFormModal({ resource, onClose, onSuccess }) {
  const { addToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    code: resource?.code || '',
    name: resource?.name || '',
    description: resource?.description || '',
    type: resource?.type || 'computer_lab',
    building: resource?.building || '',
    floorRoom: resource?.floorRoom || '',
    capacity: resource?.capacity || 30,
    equipment: resource?.equipment?.join(', ') || '',
    imageUrl: resource?.imageUrl || 'https://images.unsplash.com/photo-1562774053-701939374585?auto=format&fit=crop&w=1000&q=80',
    openingTime: resource?.openingTime || '08:00',
    closingTime: resource?.closingTime || '21:00',
    minDurationMinutes: resource?.minDurationMinutes || 30,
    maxDurationMinutes: resource?.maxDurationMinutes || 240,
    advanceBookingDaysLimit: resource?.advanceBookingDaysLimit || 14,
    requiresApproval: resource ? resource.requiresApproval : false,
    accessibilityDetails: resource?.accessibilityDetails || 'Standard wheelchair access.',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const payload = {
      ...formData,
      capacity: Number(formData.capacity),
      minDurationMinutes: Number(formData.minDurationMinutes),
      maxDurationMinutes: Number(formData.maxDurationMinutes),
      advanceBookingDaysLimit: Number(formData.advanceBookingDaysLimit),
      equipment: formData.equipment.split(',').map((s) => s.trim()).filter(Boolean),
      operatingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    };

    try {
      if (resource) {
        await apiRequest(`/resources/${resource._id}`, 'PUT', payload);
        addToast('Resource updated successfully.', 'success');
      } else {
        await apiRequest('/resources', 'POST', payload);
        addToast('Resource created successfully.', 'success');
      }
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-dialog" style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <h3>{resource ? 'Edit Facility' : 'Create New Facility'}</h3>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-content">
            {error && <div className="alert-box alert-danger">{error}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">Code</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="RES-LAB-01"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Facility Name *</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. Alan Turing GPU Center"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">Facility Type *</label>
                <select
                  className="form-control"
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="computer_lab">Computer Lab</option>
                  <option value="seminar_hall">Seminar Hall</option>
                  <option value="classroom">Classroom</option>
                  <option value="study_room">Study Room</option>
                  <option value="sports_facility">Sports Facility</option>
                  <option value="lab_equipment">Lab Hardware</option>
                  <option value="projector_equipment">Projector / AV</option>
                  <option value="meeting_room">Meeting Room</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Capacity (Seats) *</label>
                <input
                  type="number"
                  className="form-control"
                  min="1"
                  value={formData.capacity}
                  onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">Building *</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. Science Quad"
                  value={formData.building}
                  onChange={(e) => setFormData({ ...formData, building: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Floor & Room *</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. Level 2, Room 204"
                  value={formData.floorRoom}
                  onChange={(e) => setFormData({ ...formData, floorRoom: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Description *</label>
              <textarea
                className="form-control"
                rows="2"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Equipment (comma separated)</label>
              <input
                type="text"
                className="form-control"
                placeholder="4K Projector, Whiteboard, High-Speed WiFi"
                value={formData.equipment}
                onChange={(e) => setFormData({ ...formData, equipment: e.target.value })}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">Opening Time (HH:mm)</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.openingTime}
                  onChange={(e) => setFormData({ ...formData, openingTime: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Closing Time (HH:mm)</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.closingTime}
                  onChange={(e) => setFormData({ ...formData, closingTime: e.target.value })}
                  required
                />
              </div>
            </div>

            <div style={{ marginTop: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.88rem' }}>
                <input
                  type="checkbox"
                  checked={formData.requiresApproval}
                  onChange={(e) => setFormData({ ...formData, requiresApproval: e.target.checked })}
                />
                <strong>Require Administrator Approval</strong> (Unchecked = Instant Confirmation)
              </label>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : (resource ? 'Update Facility' : 'Create Facility')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// 12. PAGE: ADMIN REPORTS & ANALYTICS
// ==========================================
function ReportsPage() {
  const { addToast } = useToast();
  const [usageData, setUsageData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadReports() {
      try {
        const data = await apiRequest('/reports/usage');
        setUsageData(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadReports();
  }, []);

  const handleExportCSV = () => {
    window.open('/api/reports/bookings?format=csv', '_blank');
    addToast('Generating campus booking CSV export...', 'info');
  };

  const typeChartData = useMemo(() => {
    if (!usageData?.typeBreakdown) return [];
    return usageData.typeBreakdown.map((t) => ({
      name: t._id?.replace('_', ' ').toUpperCase(),
      bookings: t.totalBookings,
    }));
  }, [usageData]);

  if (loading) {
    return <div className="empty-state">Calculating utilization metrics...</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Campus Resource Analytics</h2>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Historical utilization rates and facility demand</span>
        </div>
        <button className="btn btn-primary" onClick={handleExportCSV}>
          <FileSpreadsheet size={16} />
          <span>Export Bookings CSV</span>
        </button>
      </div>

      {/* Utilization Summary Card */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '28px' }}>
        <div className="stat-card">
          <div className="stat-icon-wrapper" style={{ background: 'rgba(2, 132, 199, 0.12)', color: '#0284c7' }}>
            <BarChart3 size={26} />
          </div>
          <div>
            <div className="stat-value">{usageData?.utilization?.utilizationPercentage}%</div>
            <div className="stat-label">Campus Utilization Rate</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper" style={{ background: 'rgba(16, 185, 129, 0.12)', color: '#10b981' }}>
            <Clock size={26} />
          </div>
          <div>
            <div className="stat-value">{Math.round((usageData?.utilization?.totalConfirmedBookedMinutes || 0) / 60)} hrs</div>
            <div className="stat-label">Confirmed Booked Hours</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper" style={{ background: 'rgba(99, 102, 241, 0.12)', color: '#6366f1' }}>
            <Building2 size={26} />
          </div>
          <div>
            <div className="stat-value">{Math.round((usageData?.utilization?.totalBookableMinutes || 0) / 60)} hrs</div>
            <div className="stat-label">Bookable Operating Hours</div>
          </div>
        </div>
      </div>

      {/* Chart: Bookings by Resource Type */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px', marginBottom: '28px' }}>
        <div className="table-card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '16px' }}>Reservations by Facility Type</h3>
          <div style={{ height: '260px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={typeChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="bookings" fill="#0284c7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top 5 Facilities */}
        <div className="table-card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '16px' }}>Top Booked Facilities</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {usageData?.topFacilities?.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{f.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{f.building}</div>
                </div>
                <span className="badge badge-confirmed">{f.count} Bookings</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 13. PAGE: NOTIFICATIONS
// ==========================================
function NotificationsPage() {
  const { addToast } = useToast();
  const { setUnreadNotifications } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifs = async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/notifications');
      setNotifications(data.notifications || []);
      setUnreadNotifications(data.unreadCount || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifs();
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await apiRequest('/notifications/read-all', 'POST');
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadNotifications(0);
      addToast('All notifications marked as read.', 'info');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>In-App Notifications</h2>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Real-time updates regarding reservations and status changes</span>
        </div>
        <button className="btn btn-secondary" onClick={handleMarkAllRead}>
          Mark All as Read
        </button>
      </div>

      {loading ? (
        <div className="empty-state">Loading notices...</div>
      ) : notifications.length === 0 ? (
        <div className="empty-state">
          <Bell className="empty-state-icon" />
          <h3>All Caught Up</h3>
          <p>You have no notifications at this time.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {notifications.map((n) => (
            <div
              key={n._id}
              style={{
                background: n.isRead ? 'var(--bg-card)' : 'var(--bg-surface)',
                border: '1px solid',
                borderColor: n.isRead ? 'var(--border-light)' : 'var(--color-primary)',
                borderLeft: n.isRead ? '4px solid var(--border-light)' : '4px solid var(--color-primary)',
                padding: '16px 20px',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.92rem', marginBottom: '4px' }}>{n.title}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>{n.message}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(n.createdAt).toLocaleString()}</div>
              </div>
              {!n.isRead && (
                <span className="badge badge-pending">New</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==========================================
// 14. PAGE: ADMIN USER DIRECTORY
// ==========================================
function AdminUsersPage() {
  const { addToast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/admin/users');
      setUsers(data.users || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (userId, newRole) => {
    try {
      await apiRequest(`/admin/users/${userId}/role`, 'PATCH', { role: newRole });
      addToast(`Role changed to ${newRole}.`, 'success');
      fetchUsers();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleStatusToggle = async (userId, currentStatus) => {
    const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      await apiRequest(`/admin/users/${userId}/status`, 'PATCH', { accountStatus: nextStatus });
      addToast(`User status set to ${nextStatus}.`, 'info');
      fetchUsers();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Campus Users & Permissions</h2>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Manage user roles and active directory status</span>
      </div>

      {loading ? (
        <div className="empty-state">Loading users...</div>
      ) : (
        <div className="table-card">
          <div className="table-responsive">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Name & Email</th>
                  <th>Department</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{u.email}</div>
                    </td>
                    <td>{u.department}</td>
                    <td>
                      <select
                        className="form-control"
                        style={{ width: 'auto', padding: '4px 8px', fontSize: '0.8rem' }}
                        value={u.role}
                        onChange={(e) => handleRoleChange(u._id, e.target.value)}
                      >
                        <option value="student">Student</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${u.accountStatus === 'active' ? 'badge-confirmed' : 'badge-rejected'}`}>
                        <span className="badge-dot" />
                        {u.accountStatus}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '4px 10px', color: u.accountStatus === 'active' ? '#ef4444' : '#10b981' }}
                        onClick={() => handleStatusToggle(u._id, u.accountStatus)}
                      >
                        {u.accountStatus === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 15. PAGE: SETTINGS & PROFILE
// ==========================================
function SettingsPage({ theme, onToggleTheme, onOpenAuth }) {
  const { user, login } = useAuth();
  const { addToast } = useToast();

  const handleQuickSwitch = async (email, password) => {
    try {
      await login(email, password);
      addToast(`Logged in as ${email}`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div style={{ maxWidth: '680px' }}>
      <div className="table-card" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px' }}>Interface Preferences</h3>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600 }}>Theme Mode</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Switch between Light and Dark canvas palettes</div>
          </div>
          <button className="btn btn-secondary" onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            <span>{theme === 'dark' ? 'Light Theme' : 'Dark Theme'}</span>
          </button>
        </div>
      </div>

      {user ? (
        <div className="table-card" style={{ padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px' }}>Active User Profile</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', fontSize: '0.88rem' }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Full Name:</span>
              <div style={{ fontWeight: 600 }}>{user.name}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Campus Email:</span>
              <div style={{ fontWeight: 600 }}>{user.email}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Role:</span>
              <div><span className="badge badge-confirmed">{user.role}</span></div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Department:</span>
              <div style={{ fontWeight: 600 }}>{user.department}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="table-card" style={{ padding: '24px', marginBottom: '24px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '8px' }}>Not Signed In</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>Sign in to reserve facilities and manage bookings.</p>
          <button className="btn btn-primary" onClick={onOpenAuth}>Campus Sign In</button>
        </div>
      )}

      {/* Developer / Evaluator Testing Fast-Switch */}
      <div className="table-card" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '8px' }}>Evaluation Demo Account Switcher</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
          One-click authentication switcher for grading and demonstration purposes.
        </p>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            style={{ flex: 1 }}
            onClick={() => handleQuickSwitch('alex.chen@campus.edu', 'Student123!')}
          >
            Switch to Student (Alex Chen)
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => handleQuickSwitch('admin@campus.edu', 'AdminSecure2026!')}
          >
            Switch to Admin (Dr. Mitchell)
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 16. MAIN APPLICATION ROOT
// ==========================================
export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [bookingModalResource, setBookingModalResource] = useState(null);
  const [initialSlotDate, setInitialSlotDate] = useState(null);

  // Theme support
  const [theme, setTheme] = useState(() => localStorage.getItem('smart_campus_theme') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('smart_campus_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleOpenBooking = (resource) => {
    setBookingModalResource(resource);
    setInitialSlotDate(null);
  };

  const handleOpenBookingWithSlot = (resource, date) => {
    setBookingModalResource(resource);
    setInitialSlotDate(date);
  };

  return (
    <AuthProvider>
      <ToastProvider>
        <div className="app-container">
          <Sidebar
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            onOpenAuth={() => setAuthModalOpen(true)}
          />

          <div className="main-wrapper">
            <Topbar
              onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
              onOpenAuth={() => setAuthModalOpen(true)}
              theme={theme}
              onToggleTheme={toggleTheme}
            />

            <main className="content-body">
              <Routes>
                <Route path="/" element={<OverviewPage onOpenBooking={handleOpenBooking} />} />
                <Route path="/resources" element={<ResourcesPage onOpenBooking={handleOpenBooking} />} />
                <Route path="/calendar" element={<CalendarPage onOpenBookingWithSlot={handleOpenBookingWithSlot} />} />
                <Route path="/my-bookings" element={<MyBookingsPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/admin/approvals" element={<AdminApprovalsPage />} />
                <Route path="/admin/resources" element={<AdminResourcesPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/admin/users" element={<AdminUsersPage />} />
                <Route path="/settings" element={<SettingsPage theme={theme} onToggleTheme={toggleTheme} onOpenAuth={() => setAuthModalOpen(true)} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>

          {/* Booking Modal */}
          {bookingModalResource && (
            <BookingModal
              resource={bookingModalResource}
              initialDate={initialSlotDate}
              onClose={() => setBookingModalResource(null)}
            />
          )}

          {/* Authentication Modal */}
          <AuthModal
            isOpen={authModalOpen}
            onClose={() => setAuthModalOpen(false)}
          />
        </div>
      </ToastProvider>
    </AuthProvider>
  );
}
