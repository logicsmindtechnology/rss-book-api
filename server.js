const express = require('express');
const mysql = require('mysql2');

// Initialize app
const app = express();

// Parse JSON bodies
app.use(express.json());

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

// Test route
app.get('/', (req, res) => {
  res.send('Server is running!');
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

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
