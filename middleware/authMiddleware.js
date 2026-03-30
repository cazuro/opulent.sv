const jwt = require('jsonwebtoken');
const User = require('../models/user');

// Verificar si el usuario está autenticado
exports.protect = async (req, res, next) => {
  // Establecer encabezados para prevenir el almacenamiento en caché
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token || token === '') {
    // Eliminar cualquier cookie inválida
    res.cookie('jwt', '', {
      httpOnly: true,
      expires: new Date(0),
      path: '/'
    });
    return res.status(401).redirect('/auth/login');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verificar que el token no haya expirado
    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < currentTime) {
      // Token expirado, eliminar cookie
      res.cookie('jwt', '', {
        httpOnly: true,
        expires: new Date(0),
        path: '/'
      });
      return res.status(401).redirect('/auth/login');
    }
    
    req.user = await User.findById(decoded.id);
    
    if (!req.user) {
      // Usuario no encontrado, eliminar cookie
      res.cookie('jwt', '', {
        httpOnly: true,
        expires: new Date(0),
        path: '/'
      });
      return res.status(401).redirect('/auth/login');
    }
    
    // Usuario autenticado exitosamente
    next();
  } catch (err) {
    console.error('Error de autenticación:', err);
    // Error al verificar token, eliminar cookie
    res.cookie('jwt', '', {
      httpOnly: true,
      expires: new Date(0),
      path: '/'
    });
    return res.status(401).redirect('/auth/login');
  }
};

// Verificar usuario actual para las vistas
exports.checkUser = async (req, res, next) => {
  // Establecer encabezados para prevenir el almacenamiento en caché
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  
  // Solo procesar solicitudes HTTP normales, no para archivos estáticos
  if (req.path.startsWith('/css') || req.path.startsWith('/js') || req.path.startsWith('/img') || req.path.startsWith('/pdf')) {
    return next();
  }
  
  const token = req.cookies?.jwt;
  
  if (token && token !== '') {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Verificar que el usuario existe en la base de datos
      const user = await User.findById(decoded.id);
      if (!user) {
        // Usuario no encontrado, eliminar cookie y continuar
        res.cookie('jwt', '', {
          httpOnly: true,
          expires: new Date(0),
          path: '/'
        });
        res.locals.user = null;
      } else {
        res.locals.user = user;
      }
    } catch (err) {
      console.error('Error al verificar token:', err.message);
      // Error al verificar token, eliminar cookie
      res.cookie('jwt', '', {
        httpOnly: true,
        expires: new Date(0),
        path: '/'
      });
      res.locals.user = null;
    }
  } else {
    res.locals.user = null;
  }
  next();
};