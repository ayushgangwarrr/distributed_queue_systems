/**
 * src/app.js
 *
 * Express application configuration.
 * Mounts body parsing, routes, and error handling middleware.
 * Exports the app instance without calling listen() for modularity and testability.
 */

const express = require('express');
const routes = require('./api/routes');
const errorHandler = require('./api/errorHandler');

const path = require('path');

const app = express();

// Enable CORS for local dashboard development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Parse JSON request bodies
app.use(express.json());

// Serve static dashboard (prefer production build in dist if present, else root dashboard)
const fs = require('fs');
const distPath = path.join(__dirname, '../dashboard/dist');
const dashboardPath = fs.existsSync(distPath) ? distPath : path.join(__dirname, '../dashboard');
app.use('/dashboard', express.static(dashboardPath));

// Mount API routes under root
app.use('/', routes);

// Centralized error handling middleware (must be last)
app.use(errorHandler);

module.exports = app;
