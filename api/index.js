const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/src/app.module');
const { ValidationPipe } = require('@nestjs/common');
const { HttpAdapterHost } = require('@nestjs/core');
const { AllExceptionsFilter } = require('../dist/src/all-exceptions.filter');

let app;

async function getApp() {
  if (!app) {
    app = await NestFactory.create(AppModule, {
      rawBody: true,
      logger: console, // Ensure logs are printed
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
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, true); 
        }
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
  }
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
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
    });
  }
};
