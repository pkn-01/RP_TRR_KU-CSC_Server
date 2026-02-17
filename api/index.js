const fs = require('fs');
const path = require('path');

// Global app cache for warm starts
let appCache = null;

// Helper to debug file system if module load fails
function debugFs(startPath) {
  try {
    const items = fs.readdirSync(startPath);
    console.log(`Contents of ${startPath}:`, items);
    items.forEach(item => {
        const itemPath = path.join(startPath, item);
        if (fs.statSync(itemPath).isDirectory()) {
            console.log(`Contents of ${itemPath}:`, fs.readdirSync(itemPath));
        }
    });
  } catch (e) {
    console.error(`Error reading ${startPath}:`, e.message);
  }
}

async function getApp() {
  if (appCache) return appCache;

  // Verify dist/src/app.module exists before requiring
  // Note: Vercel function root might be different from project root
  // We assume api/index.js is at PROJECT_ROOT/api/index.js
  // And dist is at PROJECT_ROOT/dist
  // So path to dist/src/app.module is ../dist/src/app.module
  
  const modulePathRel = '../dist/src/app.module';
  const modulePathAbs = path.resolve(__dirname, modulePathRel + '.js');

  if (!fs.existsSync(modulePathAbs)) {
     console.error(`Module not found at ${modulePathAbs}`);
     console.log('Current directory:', __dirname);
     debugFs(path.resolve(__dirname, '..')); // List project root
     throw new Error(`Module not found: ${modulePathRel}`);
  }

  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(modulePathRel);
  const { ValidationPipe } = require('@nestjs/common');
  const { HttpAdapterHost } = require('@nestjs/core');
  const { AllExceptionsFilter } = require('../dist/src/all-exceptions.filter'); // Also check this

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
      // Allow all in serverless environment for now to fix CORS issues
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
    console.error('Serverless Function Error (Detailed):', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Internal Server Error (Backend Init Failed)',
      error: error.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
      debug: {
        cwd: process.cwd(),
        dirname: __dirname,
      }
    });
  }
};
