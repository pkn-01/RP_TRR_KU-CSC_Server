const fs = require('fs');
const path = require('path');

// Global app cache for warm starts
let appCache = null;

function getDirectoryStructure(dir) {
  try {
    const items = fs.readdirSync(dir);
    const structure = {};
    items.forEach(item => {
      const fullPath = path.join(dir, item);
      try {
        if (fs.statSync(fullPath).isDirectory()) {
            // For dist, recurse deeper to help debug
            if (item === 'dist' || dir.endsWith('dist') || dir.endsWith('src')) {
                structure[item] = getDirectoryStructure(fullPath);
            } else {
                structure[item] = fs.readdirSync(fullPath).slice(0, 10); // Limit output
            }
        } else {
            structure[item] = 'file';
        }
      } catch (e) {
        structure[item] = 'error accessing';
      }
    });
    return structure;
  } catch (e) {
    return `Error reading ${dir}: ${e.message}`;
  }
}

async function getApp() {
  if (appCache) return appCache;

  // Debug: Check where we are
  const projectRoot = path.resolve(__dirname, '..');
  
  // Try to find app.module.js
  // Common paths to check
  const potentialPaths = [
    '../dist/src/app.module.js',
    '../dist/app.module.js',
    './app.module.js',
    '../app.module.js'
  ];

  let modulePath = null;
  for (const p of potentialPaths) {
    const absPath = path.resolve(__dirname, p);
    if (fs.existsSync(absPath)) {
      modulePath = p;
      break;
    }
  }

  // If still not found, throw error but catch it in handler to show directory structure
  if (!modulePath) {
     const distPath = path.join(__dirname, '../dist');
     let distContents = "dist not found";
     if (fs.existsSync(distPath)) {
        distContents = getDirectoryStructure(distPath);
     }
     throw new Error(`Could not find app.module.js. Checked: ${potentialPaths.join(', ')}. Dist contents: ${JSON.stringify(distContents)}`);
  }

  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(modulePath);
  const { ValidationPipe } = require('@nestjs/common');
  const { HttpAdapterHost } = require('@nestjs/core');
  
  // Try to find filter
  const filterPathRel = '../dist/src/all-exceptions.filter';
  const filterPathAbs = path.resolve(__dirname, filterPathRel + '.js');
  
  let AllExceptionsFilter;
  if (fs.existsSync(filterPathAbs)) {
      AllExceptionsFilter = require(filterPathRel).AllExceptionsFilter;
  } else {
      console.warn("AllExceptionsFilter not found at " + filterPathAbs);
      // Fallback dummy filter if missing (to prevent crash)
      AllExceptionsFilter = class { catch(exception, host) {} };
  }

  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: console,
  });

  const httpAdapter = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));

  // CORS Configuration
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://rp-trr-client-internship.vercel.app',
    'https://rp-trr-server-internship.vercel.app',
    'https://rp-trr-ku-csc-2026.vercel.app',
    'https://qa-rp-trr-ku-csc.vercel.app',
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      callback(null, true);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      skipMissingProperties: true,
    }),
  );

  await app.init();
  appCache = app;
  return app;
}

module.exports = async function handler(req, res) {
  try {
    const nestApp = await getApp();
    const expressInstance = nestApp.getHttpAdapter().getInstance();
    expressInstance(req, res);
  } catch (error) {
    console.error('Serverless Function Error:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Internal Server Error (Backend Init Failed)',
      error: error.message,
      debug: {
        cwd: process.cwd(),
        dirname: __dirname,
        // Detailed recursive listing for dist
        rootContents: getDirectoryStructure(path.resolve(__dirname, '..')),
      }
    });
  }
};
