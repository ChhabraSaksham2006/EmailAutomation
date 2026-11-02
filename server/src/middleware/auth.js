import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

export function getJwtSecret() {
  return process.env.JWT_SECRET || 'dev-cold-outreach-jwt-secret-change-in-prod';
}

export function signAuthToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      email: user.email,
      role: user.role
    },
    getJwtSecret(),
    { expiresIn: '12h' } // Short-lived JWT as specified in Section 13
  );
}

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, getJwtSecret());
    const user = await User.findById(decoded.sub).select('-passwordHash').lean();
    if (!user) {
      return res.status(401).json({ error: 'User account no longer exists' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}
