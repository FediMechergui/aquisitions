import aj from '#config/arcjet.js';
import logger from '#config/logger.js';

const securityMiddleware = async (req, res, next) => {
  try {
    const decision = await aj.protect(req);
    
    if (decision.isDenied() && decision.reason.isBot()) {
      logger.warn('Bot detected:', {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        path: req.path,
      });
      return res.status(403).json({ error: 'Forbidden', message: 'Bot traffic is not allowed' });
    }

    if (decision.isDenied() && decision.reason.isShield()) {
      logger.warn('Shield Request detected:', {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        path: req.path,
        method: req.method,
      });
      return res.status(403).json({ error: 'Forbidden', message: 'Request Blocked BY SECURITY POLICY' });
    }

    if (decision.isDenied() && decision.reason.isRateLimit()) {
      logger.warn('Rate Limit Exceeded:', {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        path: req.path,
      });
      return res.status(429).json({ error: 'Too Many Requests', message: 'Rate limit exceeded' });
    }
    
    next();
  } catch (e) {
    logger.error('Arcjet middleware error:', e);
    res.status(500).json({ error: 'Internal Server Error', message: 'something went wrong with arcjet' });
  }
};

export default securityMiddleware;