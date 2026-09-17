import { verifyToken } from '../utils/jwt.js';
import prisma from '../config/prisma.js';

/**
 * authenticate — verifies the JWT sent in the Authorization header.
 * On success, attaches req.user = { id, name, email, role, companyId }
 * to the request so every route after this middleware knows who's
 * making the call, and which company (if any) they're scoped to.
 *
 * Usage on a route:
 *   router.get('/some-protected-route', authenticate, someController)
 */
export default async function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing or malformed Authorization header' });
  }

  const token = header.split(' ')[1];

  try {
    const decoded = verifyToken(token); // { userId, role, iat, exp }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, name: true, email: true, role: true, companyId: true },
    });

    if (!user) {
      // Token is valid but the user was deleted since it was issued
      return res.status(401).json({ message: 'User no longer exists' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}
