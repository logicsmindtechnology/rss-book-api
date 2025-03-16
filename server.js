require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Razorpay = require('razorpay');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const uuid = require('uuid');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from book-store/src/assets
app.use('/assets', express.static(path.join(__dirname, '../book-store/src/assets')));

// Add CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Add this after your middleware setup
app.use('/assets/book-covers', express.static(path.join(__dirname, '../book-store/src/assets/book-covers')));

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database connection
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'Ganesha32145#',
  database: 'book_store',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}).promise();

// Check and update schema on startup
async function checkAndUpdateSchema() {
  try {
    console.log('Checking database schema...');
    
    // Check if the publisherUrl column exists
    const [columns] = await pool.query('SHOW COLUMNS FROM books LIKE "publisherUrl"');
    
    if (columns.length === 0) {
      console.log('Adding missing columns to books table...');
      
      // Add publisherUrl column
      await pool.query('ALTER TABLE books ADD COLUMN publisherUrl VARCHAR(255) NULL');
      console.log('Added publisherUrl column');
      
      // Add bookType column if it doesn't exist
      try {
        await pool.query('ALTER TABLE books ADD COLUMN bookType VARCHAR(20) DEFAULT "internal"');
        console.log('Added bookType column');
      } catch (error) {
        // Column might already exist
        console.log('bookType column may already exist');
      }
      
      // Add stock column if it doesn't exist
      try {
        await pool.query('ALTER TABLE books ADD COLUMN stock INT DEFAULT 0');
        console.log('Added stock column');
      } catch (error) {
        // Column might already exist
        console.log('stock column may already exist');
      }
      
      // Add created_by and updated_by columns
      try {
        await pool.query('ALTER TABLE books ADD COLUMN created_by INT NULL');
        await pool.query('ALTER TABLE books ADD COLUMN updated_by INT NULL');
        console.log('Added created_by and updated_by columns');
      } catch (error) {
        // Columns might already exist
        console.log('created_by and updated_by columns may already exist');
      }
    } else {
      console.log('Database schema is up to date');
    }
  } catch (error) {
    console.error('Error checking or updating schema:', error);
  }
}

// Call the function to check and update schema
checkAndUpdateSchema();

// Test database connection
pool.query('SELECT 1')
  .then(() => {
    console.log('Database connected successfully');
  })
  .catch((err) => {
    console.error('Database connection failed:', err);
    process.exit(1);
  });

// Razorpay instance (optional for development)
let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
} else {
  console.warn('Razorpay credentials not found. Payment features will be disabled.');
}

// reCAPTCHA secret key
const RECAPTCHA_SECRET_KEY = '6LeJ4qYqAAAAAIoO9g-RNaBNlrGgnCohZUo0YXbt';

// Function to verify reCAPTCHA
async function verifyRecaptcha(token) {
  try {
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET_KEY}&response=${token}`
    );
    return response.data.success;
  } catch (error) {
    console.error('reCAPTCHA verification error:', error);
    return false;
  }
}

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid token' });
  }
};

// Admin middleware
const authenticateAdmin = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Admin authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid admin token' });
  }
};

// Configure multer for image upload
const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../book-store/src/assets/book-covers');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error, null);
    }
  },
  filename: function (req, file, cb) {
    // Generate unique filename: timestamp + random string + extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'book-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB limit
  },
  fileFilter: function (req, file, cb) {
    // Accept only image files
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, mobile, state, city, recaptcha } = req.body;

    // Verify reCAPTCHA first
    const isRecaptchaValid = await verifyRecaptcha(recaptcha);
    if (!isRecaptchaValid) {
      return res.status(400).json({ message: 'Invalid reCAPTCHA. Please try again.' });
    }

    // Validate required fields
    if (!name || !mobile || !email || !password || !state || !city) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Check if user already exists
    const [existingUsers] = await pool.execute(
      'SELECT * FROM users WHERE email = ? OR mobile = ?',
      [email, mobile]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'User already exists with this email or mobile' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user
    const [result] = await pool.execute(
      'INSERT INTO users (name, mobile, email, password, state, city) VALUES (?, ?, ?, ?, ?, ?)',
      [name, mobile, email, hashedPassword, state, city]
    );

    res.status(201).json({
      message: 'User registered successfully',
      userId: result.insertId
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Error registering user', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const [users] = await pool.execute(
      'SELECT * FROM users WHERE email = ? OR mobile = ?',
      [username, username]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        state: user.state,
        city: user.city
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error logging in', error: error.message });
  }
});

// Admin Routes
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Get admin user from database
    const [admins] = await pool.execute(
      'SELECT * FROM admins WHERE username = ?',
      [username]
    );

    if (admins.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const admin = admins[0];
    const validPassword = await bcrypt.compare(password, admin.password);

    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      admin: {
        id: admin.id,
        username: admin.username
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ message: 'Error logging in', error: error.message });
  }
});

app.post('/api/admin/upload-book-image', authenticateAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file uploaded' });
    }

    // Return the filename to be stored in the database
    res.json({
      filename: req.file.filename,
      message: 'Image uploaded successfully'
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ message: 'Error uploading image', error: error.message });
  }
});

// Book image upload endpoint
app.post('/api/admin/books/upload-image', authenticateAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate the URL that will be accessible from the frontend
    const imageUrl = `/assets/book-covers/${req.file.filename}`;

    res.json({ imageUrl });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file: ' + error.message });
  }
});

// Protected admin routes
app.get('/api/admin/books', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Get paginated books
    const [books] = await pool.execute(
      'SELECT * FROM books ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );

    // Send just the books array
    res.json(books);
  } catch (error) {
    console.error('Error fetching books:', error);
    res.status(500).json({ message: 'Error fetching books', error: error.message });
  }
});

app.post('/api/admin/books', authenticateAdmin, async (req, res) => {
  try {
    const { title, author, description, price, stock, imageUrl, featured, publisherUrl, bookType } = req.body;
    const admin_id = req.admin.id;

    // Generate UUID for the book
    const bookId = uuid.v4();

    // First insert the book
    const [result] = await pool.query(
      'INSERT INTO books (id, title, author, description, price, stock, imageUrl, featured, created_by, updated_by, publisherUrl, bookType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [bookId, title, author, description, price, stock, imageUrl, featured || false, admin_id, admin_id, publisherUrl || null, bookType || 'internal']
    );

    // Then create the audit log with the new book ID
    await pool.query(
      'INSERT INTO book_audit_log (book_id, action_type, admin_id, new_values) VALUES (?, ?, ?, ?)',
      [
        bookId,
        'CREATE',
        admin_id,
        JSON.stringify({ title, author, description, price, stock, imageUrl, featured: featured || false, id: bookId, publisherUrl, bookType })
      ]
    );

    // Fetch the newly created book
    const [newBook] = await pool.query('SELECT * FROM books WHERE id = ?', [bookId]);

    res.status(201).json(newBook[0]);
  } catch (error) {
    console.error('Error adding book:', error);
    res.status(500).json({ error: 'Error adding book' });
  }
});

app.put('/api/admin/books/:id', authenticateAdmin, async (req, res) => {
  try {
    const { title, author, description, price, stock, imageUrl, featured, publisherUrl, bookType } = req.body;
    const bookId = req.params.id;
    const admin_id = req.admin.id;

    // Get old values for audit log
    const [oldBook] = await pool.query('SELECT * FROM books WHERE id = ?', [bookId]);
    
    const [result] = await pool.query(
      'UPDATE books SET title = ?, author = ?, description = ?, price = ?, stock = ?, imageUrl = ?, featured = ?, updated_by = ?, publisherUrl = ?, bookType = ? WHERE id = ?',
      [title, author, description, price, stock, imageUrl, featured || false, admin_id, publisherUrl || null, bookType || 'internal', bookId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Book not found' });
    }

    // Log the book update in audit log
    await pool.query(
      'INSERT INTO book_audit_log (book_id, action_type, admin_id, old_values, new_values) VALUES (?, ?, ?, ?, ?)',
      [bookId, 'UPDATE', admin_id, JSON.stringify(oldBook[0]), JSON.stringify(req.body)]
    );

    res.json({ id: bookId, ...req.body });
  } catch (error) {
    console.error('Error updating book:', error);
    res.status(500).json({ message: 'Error updating book', error: error.message });
  }
});

app.delete('/api/admin/books/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute('DELETE FROM books WHERE id = ?', [id]);
    res.json({ message: 'Book deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting book', error: error.message });
  }
});

// Book Routes
app.get('/api/books/featured', async (req, res) => {
  try {
    console.log('Fetching featured books...');
    const [books] = await pool.query(
      'SELECT * FROM books WHERE featured = true ORDER BY createdAt DESC'
    );
    console.log('Found featured books:', books.length);
    res.json(books);
  } catch (error) {
    console.error('Error getting featured books:', error);
    res.status(500).json({ error: 'Error getting featured books' });
  }
});

app.get('/api/books/search', async (req, res) => {
  try {
    const { query } = req.query;
    const [books] = await pool.execute(
      'SELECT * FROM books WHERE title LIKE ? OR author LIKE ? OR description LIKE ?',
      [`%${query}%`, `%${query}%`, `%${query}%`]
    );
    res.json(books);
  } catch (error) {
    res.status(500).json({ message: 'Error searching books', error: error.message });
  }
});

app.get('/api/books/category/:category', async (req, res) => {
  try {
    const category = req.params.category;
    const [books] = await pool.execute('SELECT * FROM books WHERE category = ?', [category]);
    res.json(books);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching books by category', error: error.message });
  }
});

app.get('/api/books/:id', async (req, res) => {
  try {
    const bookId = req.params.id;
    console.log('Fetching book with ID:', bookId);
    
    const [books] = await pool.execute('SELECT * FROM books WHERE id = ?', [bookId]);
    
    if (books.length === 0) {
      console.log('Book not found with ID:', bookId);
      return res.status(404).json({ message: 'Book not found' });
    }
    
    console.log('Found book:', books[0].title);
    res.json(books[0]);
  } catch (error) {
    console.error('Error fetching book by ID:', error);
    res.status(500).json({ message: 'Error fetching book details', error: error.message });
  }
});

app.get('/api/books', async (req, res) => {
  try {
    console.log('Fetching all books...');
    const [books] = await pool.query('SELECT * FROM books ORDER BY createdAt DESC');
    console.log('Found books:', books.length);
    res.json(books);
  } catch (error) {
    console.error('Error getting books:', error);
    res.status(500).json({ error: 'Error getting books' });
  }
});

app.post('/api/books/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute('UPDATE books SET views = views + 1 WHERE id = ?', [id]);
    res.json({ message: 'View count updated' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating view count', error: error.message });
  }
});

// Cart endpoints
app.post('/api/cart/add', async (req, res) => {
  try {
    const { bookId } = req.body;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/cart/remove', async (req, res) => {
  try {
    const { bookId } = req.body;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/cart/update', async (req, res) => {
  try {
    const { bookId, quantity } = req.body;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Order Routes
app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const { items, totalAmount } = req.body;
    const userId = req.user.id;

    // Create Razorpay order
    if (!razorpay) {
      return res.status(500).json({ message: 'Payment features are disabled' });
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(totalAmount * 100), // Convert to paise
      currency: 'INR',
      receipt: `order_${Date.now()}`
    });

    // Create order in database
    const [result] = await pool.execute(
      'INSERT INTO orders (user_id, total_amount, razorpay_order_id) VALUES (?, ?, ?)',
      [userId, totalAmount, razorpayOrder.id]
    );

    const orderId = result.insertId;

    // Create order items
    for (const item of items) {
      await pool.execute(
        'INSERT INTO order_items (order_id, book_id, quantity, price) VALUES (?, ?, ?, ?)',
        [orderId, item.book.id, item.quantity, item.book.price]
      );
    }

    res.json({
      orderId,
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount
    });
  } catch (error) {
    res.status(500).json({ message: 'Error creating order', error: error.message });
  }
});

app.post('/api/orders/:orderId/complete', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { razorpayPaymentId } = req.body;

    await pool.execute(
      'UPDATE orders SET status = ?, razorpay_payment_id = ? WHERE id = ?',
      ['completed', razorpayPaymentId, orderId]
    );

    res.json({ message: 'Order completed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error completing order', error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
