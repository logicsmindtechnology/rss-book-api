const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

// Initialize app
const app = express();

// Enable CORS
app.use(cors({
  origin: 'https://thankful-flower-095184710.4.azurestaticapps.net', // Allowed origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Enable credentials
}));

// Parse JSON bodies
app.use(express.json());

// Always include CORS headers even for errors
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://thankful-flower-095184710.4.azurestaticapps.net');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

// Debugging headers
app.use((req, res, next) => {
  res.on('finish', () => {
    console.log('Response Headers:', res.getHeaders());
  });
  next();
});

// Database connection
const db = mysql.createPool({
  host: '62.72.28.152',
  user: 'u451770217_root',
  password: 'Ganesha32145#', // Replace with your MySQL password
  database: 'u451770217_book_store',
  waitForConnections: true,
  connectionLimit: 30, // Max connections in pool
  queueLimit: 0
});

// Test database connection
db.getConnection((err, connection) => {
  if (err) {
    console.error('Database connection failed: ' + err.message);
  } else {
    console.log('Connected to MySQL database.');
    connection.release(); // Release connection back to pool
  }
});

// API to fetch all books
app.get('/books', (req, res) => {
  try {
    const sql = 'SELECT * FROM books';
    db.query(sql, (err, results) => {
      if (err) {
        console.error('Database query error:', err.message);
        res.status(500).send({ error: 'Database Query Error', details: err.message });
        return;
      }
      res.json(results);
    });
  } catch (error) {
    console.error('Unexpected Server Error:', error.message);
    res.status(500).send({ error: 'Internal Server Error', details: error.message });
  }
});

// API to search books by title or author
app.get('/books/search', (req, res) => {
  try {
    const { query } = req.query;

    // Input validation
    if (!query || query.trim() === '') {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const sql = `
      SELECT * FROM books
      WHERE title LIKE ? OR author LIKE ?
    `;
    db.query(sql, [`%${query}%`, `%${query}%`], (err, results) => {
      if (err) {
        console.error('Database query error:', err.message);
        res.status(500).send({ error: 'Database Query Error', details: err.message });
        return;
      }

      // No matching results
      if (results.length === 0) {
        return res.status(404).json({ message: 'No books found for the given query.' });
      }

      // Send matching results
      res.json(results);
    });
  } catch (error) {
    console.error('Unexpected Server Error:', error.message);
    res.status(500).send({ error: 'Internal Server Error', details: error.message });
  }
});

// Error handler to always return CORS headers
app.use((err, req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://thankful-flower-095184710.4.azurestaticapps.net');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(err.status || 500).send({ error: err.message });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
